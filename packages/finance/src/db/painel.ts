import { and, asc, eq, gte, lte, or, sql } from "drizzle-orm";
import type { PainelDoMes } from "../contratos-planejamento.js";
import { d, moeda } from "../decimal.js";
import { estadoDoOrcamento } from "../orcamento.js";
import { numerosDoMes, type LancamentoDoPainel } from "../painel.js";
import { obterPlanejamento } from "./planejamento.js";
import { somarDias } from "../recorrencia.js";
import { listarContas, type Tx } from "./operacoes.js";
import { accounts, cards, categories, statements, transactions } from "./schema.js";

const ultimoDia = (competencia: string) => {
  const t = new Date(`${competencia}T00:00:00Z`);
  t.setUTCMonth(t.getUTCMonth() + 1, 0);
  return t.toISOString().slice(0, 10);
};

/**
 * Dashboard do mes. Despesa e compra e conta (no cartao ou na conta); o
 * pagamento da fatura e transferencia e nao entra, para o gasto nao contar
 * duas vezes.
 */
export async function painelDoMes(
  tx: Tx,
  uid: string,
  competencia: string,
  hoje: string,
): Promise<PainelDoMes> {
  const fim = ultimoDia(competencia);
  const doMes = (await tx
    .select({
      tipo: transactions.tipo,
      valor: transactions.valor,
      status: transactions.status,
      category_id: transactions.category_id,
      transferencia_sentido: transactions.transferencia_sentido,
    })
    .from(transactions)
    .where(
      and(eq(transactions.user_id, uid), eq(transactions.competencia, competencia)),
    )) as LancamentoDoPainel[];
  const cats = await tx
    .select({
      id: categories.id,
      nome: categories.nome,
      tipo_custo: categories.tipo_custo,
    })
    .from(categories)
    .where(eq(categories.user_id, uid));
  const numeros = numerosDoMes(
    doMes,
    new Map(
      cats.map((c) => [
        c.id,
        { nome: c.nome, tipo_custo: c.tipo_custo as "fixo" | "variavel" },
      ]),
    ),
  );

  // Saldo previsto: saldo inicial mais tudo (previsto e realizado) ate o fim do mes.
  const [previsto] = await tx
    .select({
      v: sql<string>`coalesce(sum(${accounts.saldo_inicial} + coalesce((
        select sum(case
            when t.tipo = 'receita' then t.valor
            when t.tipo = 'despesa' then -t.valor
            when t.transferencia_sentido = 'entrada' then t.valor
            else -t.valor end)
          from finance.transactions t
         where t.account_id = "accounts"."id"
           and t.user_id = "accounts"."user_id"
           and t.data >= "accounts"."data_saldo_inicial"
           and t.data <= ${fim}::date
      ), 0)), 0)::numeric(18,2)::text`,
    })
    .from(accounts)
    .where(and(eq(accounts.user_id, uid), eq(accounts.arquivada, false)));

  const contas = (await listarContas(tx, uid, hoje)).filter((c) => !c.arquivada);
  const nomeDaConta = new Map(contas.map((c) => [c.id, c.nome]));

  const faturas = await tx
    .select({
      id: statements.id,
      card_id: statements.card_id,
      cartao: cards.nome,
      vencimento: statements.vencimento,
      status: statements.status,
      total: sql<string>`coalesce((select sum(case when t.tipo = 'despesa' then t.valor when t.tipo = 'receita' then -t.valor else 0 end) from finance.transactions t where t.statement_id = "statements"."id" and t.user_id = "statements"."user_id"), 0)::numeric(18,2)::text`,
    })
    .from(statements)
    .innerJoin(cards, and(eq(cards.id, statements.card_id), eq(cards.user_id, uid)))
    .where(
      and(
        eq(statements.user_id, uid),
        sql`${statements.status} <> 'paga'`,
        lte(statements.vencimento, somarDias(fim, 45)),
      ),
    )
    .orderBy(asc(statements.vencimento));

  // A pagar: saidas previstas nas contas ate 7 dias, mais as atrasadas do ultimo mes.
  const aPagar = await tx
    .select({
      id: transactions.id,
      data: transactions.data,
      descricao: transactions.descricao,
      valor: transactions.valor,
      account_id: transactions.account_id,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, uid),
        eq(transactions.status, "previsto"),
        sql`${transactions.account_id} is not null`,
        or(
          eq(transactions.tipo, "despesa"),
          eq(transactions.transferencia_sentido, "saida"),
        ),
        gte(transactions.data, somarDias(hoje, -30)),
        lte(transactions.data, somarDias(hoje, 7)),
      ),
    )
    .orderBy(asc(transactions.data));

  // Orcamento: despesas planejadas contra o consumo (realizado + previsto).
  const plano = await obterPlanejamento(tx, uid, competencia.slice(0, 7));
  const despesasPlanejadas = plano.categorias.filter((c) => c.natureza === "despesa");
  const planejado = despesasPlanejadas.reduce((s, c) => s.plus(c.planejado), d(0));
  const consumo = despesasPlanejadas.reduce((s, c) => s.plus(c.consumo), d(0));
  const [parcelas] = await tx
    .select({
      v: sql<string>`coalesce(sum(${transactions.valor}), 0)::numeric(18,2)::text`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, uid),
        eq(transactions.competencia, competencia),
        sql`${transactions.installment_plan_id} is not null`,
        sql`${transactions.parcela_numero} is not null`,
      ),
    );

  return {
    competencia,
    orcamento: {
      planejado: moeda(planejado),
      consumo: moeda(consumo),
      percentual: planejado.isZero()
        ? null
        : Number(consumo.div(planejado).times(100).toFixed(1)),
      estado: estadoDoOrcamento(moeda(planejado), moeda(consumo)),
    },
    comprometido_parcelas: moeda(d(parcelas?.v ?? "0")),
    renda: numeros.renda,
    despesas: numeros.despesas,
    saldo_previsto_fim_do_mes: moeda(d(previsto?.v ?? "0")),
    fixos: numeros.fixos,
    variaveis: numeros.variaveis,
    contas: contas.map((c) => ({ id: c.id, nome: c.nome, saldo: c.saldo_atual })),
    faturas_abertas: faturas
      .filter((f) => d(f.total).gt(0))
      .map((f) => ({ ...f, status: f.status as "aberta" | "fechada" | "paga" })),
    top_categorias: numeros.top_categorias,
    a_pagar: aPagar.map((l) => ({
      id: l.id,
      data: l.data,
      descricao: l.descricao,
      valor: l.valor,
      conta: nomeDaConta.get(l.account_id ?? "") ?? "",
      atrasado: l.data < hoje,
    })),
  };
}
