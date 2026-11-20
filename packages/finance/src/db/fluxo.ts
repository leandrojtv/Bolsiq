import { and, eq, isNull, sql } from "drizzle-orm";
import { faturaDaCompra } from "../cartao.js";
import type { FluxoDeCaixa } from "../contratos-parcelamento.js";
import { d, moeda } from "../decimal.js";
import { fluxoProjetado, type Movimento } from "../fluxo.js";
import { somarMeses } from "../parcelamento.js";
import { ocorrencias, somarDias, type RegraDeRecorrencia } from "../recorrencia.js";
import { listarContas, type Tx } from "./operacoes.js";
import { HORIZONTE_DE_RECORRENCIA } from "./recorrencias.js";
import { cards, recurrences, statements, transactions } from "./schema.js";

/**
 * Fluxo de caixa projetado das contas para os proximos `n` meses:
 * - saldo realizado de hoje;
 * - previstos nas contas (receitas, despesas, parcelas de divida, pagamento de
 *   fatura ja previsto);
 * - faturas futuras sem pagamento previsto, no vencimento (compras e parcelas
 *   no cartao);
 * - recorrencias alem do horizonte do job (90 dias), que ainda nao viraram
 *   lancamento.
 */
export async function fluxoDeCaixa(
  tx: Tx,
  uid: string,
  hoje: string,
  n: number,
): Promise<FluxoDeCaixa> {
  const contas = (await listarContas(tx, uid, hoje)).filter((c) => !c.arquivada);
  const saldo = contas.reduce((s, c) => s.plus(c.saldo_atual), d(0));
  const fim = somarDias(somarMeses(`${hoje.slice(0, 7)}-01`, n), -1);
  const movimentos: Movimento[] = [];

  const previstos = await tx
    .select({
      data: transactions.data,
      valor: transactions.valor,
      tipo: transactions.tipo,
      sentido: transactions.transferencia_sentido,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, uid),
        eq(transactions.status, "previsto"),
        sql`${transactions.account_id} is not null`,
        sql`${transactions.data} <= ${fim}::date`,
      ),
    );
  for (const l of previstos) {
    const entra =
      l.tipo === "receita" || (l.tipo === "transferencia" && l.sentido === "entrada");
    movimentos.push({ data: l.data, valor: entra ? l.valor : moeda(d(l.valor).neg()) });
  }

  // Faturas ainda sem pagamento previsto: o que falta pagar, no vencimento.
  const faturas = await tx
    .select({
      vencimento: statements.vencimento,
      falta: sql<string>`coalesce((select sum(case
          when t.tipo = 'despesa' then t.valor
          when t.tipo = 'receita' then -t.valor
          when t.transferencia_sentido = 'entrada' and t.status <> 'previsto' then -t.valor
          else 0 end)
        from finance.transactions t
       where t.statement_id = "statements"."id" and t.user_id = "statements"."user_id"), 0)::numeric(18,2)::text`,
    })
    .from(statements)
    .where(
      and(
        eq(statements.user_id, uid),
        sql`${statements.status} <> 'paga'`,
        isNull(statements.pagamento_id),
        sql`${statements.vencimento} <= ${fim}::date`,
      ),
    );
  for (const f of faturas)
    if (d(f.falta).gt(0))
      movimentos.push({ data: f.vencimento, valor: moeda(d(f.falta).neg()) });

  // Recorrencias depois do horizonte do job.
  const desde = somarDias(hoje, HORIZONTE_DE_RECORRENCIA + 1);
  const ativas = await tx
    .select({
      r: recurrences,
      ciclo_f: cards.dia_fechamento,
      ciclo_v: cards.dia_vencimento,
    })
    .from(recurrences)
    .leftJoin(cards, eq(cards.id, recurrences.card_id))
    .where(and(eq(recurrences.user_id, uid), eq(recurrences.ativa, true)));
  for (const { r, ciclo_f, ciclo_v } of ativas) {
    const regra: RegraDeRecorrencia = {
      frequencia: r.frequencia as RegraDeRecorrencia["frequencia"],
      dia: r.dia,
      inicio: r.inicio,
      fim: r.fim,
    };
    for (const data of ocorrencias(regra, desde, fim)) {
      const quando =
        r.card_id && ciclo_f && ciclo_v
          ? faturaDaCompra({ dia_fechamento: ciclo_f, dia_vencimento: ciclo_v }, data)
              .vencimento
          : data;
      movimentos.push({
        data: quando,
        valor: r.tipo === "receita" ? r.valor : moeda(d(r.valor).neg()),
      });
    }
  }

  return fluxoProjetado(moeda(saldo), movimentos, hoje, n);
}
