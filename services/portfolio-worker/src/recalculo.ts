import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { HistoryResponse } from "@bolsiq/contracts";
import type { Db } from "@bolsiq/db-core";
import {
  comoUsuario,
  diasDePregao,
  schema,
  snapshotsDiarios,
  Transacao,
  type Fechamento,
} from "@bolsiq/portfolio";

const { portfolios, transactions, snapshots } = schema;

export type Log = (nivel: string, msg: string, ctx?: Record<string, unknown>) => void;

export function clienteDePrecos(base: string, chave?: string) {
  return async (ticker: string, de: string): Promise<Fechamento[]> => {
    // Sem ajuste: desdobramento e provento ja estao nas transacoes da carteira.
    const res = await fetch(`${base}/v1/history/${ticker}?adjusted=false&from=${de}`, {
      headers: chave ? { "x-api-key": chave } : {},
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`market-data respondeu ${res.status} para ${ticker}`);
    return HistoryResponse.parse(await res.json()).data.candles.map((c) => ({
      date: c.date,
      close: c.close,
    }));
  };
}
export type BuscarPrecos = ReturnType<typeof clienteDePrecos>;

function hojeEmSp(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    new Date(),
  );
}

/**
 * Recalcula a serie inteira da carteira e regrava os snapshots.
 *
 * Inteira, e nao so a partir da data marcada: o TWR e acumulado, e uma
 * transacao retroativa muda todos os pontos seguintes. Para o volume de uma
 * carteira de pessoa fisica (centenas de transacoes, poucos anos) sai em
 * dezenas de milissegundos; o que pesa e buscar os precos.
 *
 * Le e grava como o dono da carteira, pela mesma RLS da aplicacao.
 */
export async function recalcular(
  db: Db,
  precos: BuscarPrecos,
  carteira: { id: string; user_id: string },
): Promise<number> {
  const linhas = await comoUsuario(db, carteira.user_id, (tx) =>
    tx
      .select()
      .from(transactions)
      .where(eq(transactions.portfolio_id, carteira.id))
      .orderBy(asc(transactions.data)),
  );
  const txs = linhas.map((l) =>
    Transacao.parse({
      id: l.id,
      ticker: l.ticker,
      tipo: l.tipo,
      data: l.data,
      quantidade: l.quantidade,
      preco: l.preco,
      taxas: l.taxas,
    }),
  );

  const inicio = txs[0]?.data;
  const fechamentos: Record<string, Fechamento[]> = {};
  if (inicio) {
    const tickers = [...new Set(txs.map((t) => t.ticker))];
    const series = await Promise.all(tickers.map((t) => precos(t, inicio)));
    tickers.forEach((t, i) => (fechamentos[t] = series[i] ?? []));
  }
  const serie = inicio
    ? snapshotsDiarios(txs, fechamentos, diasDePregao(fechamentos, inicio, hojeEmSp()))
    : [];

  await comoUsuario(db, carteira.user_id, async (tx) => {
    await tx.delete(snapshots).where(eq(snapshots.portfolio_id, carteira.id));
    for (let i = 0; i < serie.length; i += 500) {
      await tx.insert(snapshots).values(
        serie.slice(i, i + 500).map((s) => ({
          portfolio_id: carteira.id,
          user_id: carteira.user_id,
          data: s.data,
          valor_bruto: s.valor_bruto,
          custo_total: s.custo_total,
          resultado_nao_realizado: s.resultado_nao_realizado,
          resultado_realizado_acumulado: s.resultado_realizado_acumulado,
          proventos_acumulados: s.proventos_acumulados,
          fluxo_caixa: s.fluxo_caixa,
          retorno_twr: s.retorno_twr === null ? null : String(s.retorno_twr),
          base_100: String(s.base_100),
        })),
      );
    }
  });
  return serie.length;
}

/**
 * Carteiras marcadas. Le com a conexao do dono das tabelas, sem RLS: e a
 * unica consulta que cruza usuarios, e devolve so id e dono. Todo o resto
 * roda como o usuario.
 */
export async function marcadas(db: Db) {
  return db
    .select({
      id: portfolios.id,
      user_id: portfolios.user_id,
      desde: portfolios.recalcular_desde,
    })
    .from(portfolios)
    .where(isNotNull(portfolios.recalcular_desde))
    .limit(50);
}

export async function desmarcar(db: Db, id: string, desde: string): Promise<void> {
  // So limpa se ninguem marcou de novo enquanto o recalculo rodava.
  await db
    .update(portfolios)
    .set({ recalcular_desde: null })
    .where(and(eq(portfolios.id, id), eq(portfolios.recalcular_desde, desde)));
}

/** Snapshot do fechamento: marca todas as carteiras com transacao. */
export async function marcarTodas(db: Db): Promise<number> {
  const r = await db.execute(sql`
    update portfolio.portfolios p set recalcular_desde = current_date
    where not p.arquivada
      and exists (select 1 from portfolio.transactions t where t.portfolio_id = p.id)
  `);
  return r.rowCount ?? 0;
}
