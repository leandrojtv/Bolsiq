import { and, asc, desc, eq, sql } from "drizzle-orm";
import { d, moeda } from "../decimal.js";
import type { PartesDoFinance, Patrimonio } from "../patrimonio.js";
import type { FaturaAPagar } from "../vigia.js";
import { listarContas, type Tx } from "./operacoes.js";
import { listarPlanos } from "./parcelamentos.js";
import { cards, net_worth_snapshots, statements, transactions } from "./schema.js";

/**
 * Faturas nao pagas com o que ja foi comprado (realizado) e pago. O previsto
 * (parcela futura, pagamento gerado no fechamento) ainda nao e divida.
 */
export async function faturasAPagar(tx: Tx, uid: string): Promise<FaturaAPagar[]> {
  const linhas = await tx
    .select({
      id: statements.id,
      card_id: statements.card_id,
      cartao: cards.nome,
      vencimento: statements.vencimento,
      status: sql<FaturaAPagar["status"]>`${statements.status}`,
      total: sql<string>`coalesce(sum(case when ${transactions.status} <> 'previsto' and ${transactions.tipo} = 'despesa' then ${transactions.valor} when ${transactions.status} <> 'previsto' and ${transactions.tipo} = 'receita' then -${transactions.valor} else 0 end), 0)::numeric(18,2)::text`,
      pagamentos: sql<string>`coalesce(sum(case when ${transactions.transferencia_sentido} = 'entrada' and ${transactions.status} <> 'previsto' then ${transactions.valor} else 0 end), 0)::numeric(18,2)::text`,
    })
    .from(statements)
    .innerJoin(cards, and(eq(cards.id, statements.card_id), eq(cards.user_id, uid)))
    .leftJoin(
      transactions,
      and(eq(transactions.statement_id, statements.id), eq(transactions.user_id, uid)),
    )
    .where(and(eq(statements.user_id, uid), sql`${statements.status} <> 'paga'`))
    .groupBy(statements.id, cards.nome)
    .orderBy(asc(statements.vencimento));
  return linhas;
}

/** Contas, faturas e dividas do usuario em `hoje`, pela RLS de quem chama. */
export async function partesDoFinance(
  tx: Tx,
  uid: string,
  hoje: string,
): Promise<PartesDoFinance> {
  const contas = (await listarContas(tx, uid, hoje))
    .filter((c) => !c.arquivada)
    .reduce((s, c) => s.plus(c.saldo_atual), d(0));
  const faturas = (await faturasAPagar(tx, uid)).reduce((s, f) => {
    const aPagar = d(f.total).minus(f.pagamentos);
    return aPagar.gt(0) ? s.plus(aPagar) : s;
  }, d(0));
  // Parcelado no cartao ja aparece na fatura (as parcelas futuras sao
  // previstas e nao contam): so emprestimo e financiamento viram divida aqui.
  const dividas = (await listarPlanos(tx, uid))
    .filter((p) => p.origem !== "cartao")
    .reduce((s, p) => s.plus(p.saldo_devedor), d(0));
  return { contas: moeda(contas), faturas: moeda(faturas), dividas: moeda(dividas) };
}

/**
 * Grava a foto do mes (`YYYY-MM`). Idempotente: a primeira foto do mes vale e
 * as seguintes sao ignoradas, para o job poder repetir sem mudar a historia.
 */
export async function gravarSnapshotDoPatrimonio(
  tx: Tx,
  uid: string,
  mes: string,
  p: Patrimonio,
): Promise<boolean> {
  const r = await tx
    .insert(net_worth_snapshots)
    .values({
      user_id: uid,
      mes: `${mes}-01`,
      contas: p.contas,
      renda_variavel: p.renda_variavel,
      renda_fixa: p.renda_fixa,
      fundos: p.fundos,
      faturas: p.faturas,
      dividas: p.dividas,
      patrimonio_liquido: p.patrimonio_liquido,
      carteiras: p.carteiras,
      carteiras_avaliadas_em: p.carteiras_avaliadas_em,
    })
    .onConflictDoNothing()
    .returning({ mes: net_worth_snapshots.mes });
  return r.length > 0;
}

export interface PontoDoPatrimonio {
  /** `YYYY-MM` */
  mes: string;
  patrimonio_liquido: string;
  contas: string;
  investimentos: string;
  dividas: string;
}

/** Ultimas `n` fotos, do mes mais antigo para o mais novo. */
export async function evolucaoDoPatrimonio(
  tx: Tx,
  uid: string,
  n = 24,
): Promise<PontoDoPatrimonio[]> {
  const linhas = await tx
    .select()
    .from(net_worth_snapshots)
    .where(eq(net_worth_snapshots.user_id, uid))
    .orderBy(desc(net_worth_snapshots.mes))
    .limit(n);
  return linhas.reverse().map((l) => ({
    mes: l.mes.slice(0, 7),
    patrimonio_liquido: l.patrimonio_liquido,
    contas: l.contas,
    investimentos: moeda(d(l.renda_variavel).plus(l.renda_fixa).plus(l.fundos)),
    dividas: moeda(d(l.faturas).plus(l.dividas)),
  }));
}
