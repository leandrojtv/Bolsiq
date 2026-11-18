import "server-only";
import { desc, eq } from "drizzle-orm";
import { indicators } from "@bolsiq/analytics";
import { criarDb, criarPool, type Db } from "@bolsiq/db-core";
import { env } from "./env";

/** Indicadores que a pagina do ativo mostra. Razao como number; preco como string. */
export interface Indicadores {
  reference_date: string;
  pl: number | null;
  pvp: number | null;
  dy_12m: number | null;
  ev_ebitda: number | null;
  roe: number | null;
  margem_liquida: number | null;
  dl_ebitda: number | null;
  beta: number | null;
  preco_graham: string | null;
  margem_graham: number | null;
  preco_bazin: string | null;
  margem_bazin: number | null;
}

let db: Db | undefined;
export function banco(): Db {
  db ??= criarDb(criarPool({ url: env.DATABASE_URL, maxConnections: 4 }));
  return db;
}

const num = (v: string | null) => (v === null ? null : Number(v));

/**
 * Ultimos indicadores do ticker.
 *
 * O analytics e modulo do app (ADR 0009): o app le o schema `analytics`
 * direto. O que nao pode e ler o `market_data`, que e de outro servico.
 */
export async function indicadoresDe(ticker: string): Promise<Indicadores | null> {
  const [l] = await banco()
    .select()
    .from(indicators)
    .where(eq(indicators.ticker, ticker))
    .orderBy(desc(indicators.reference_date))
    .limit(1);
  if (!l) return null;
  return {
    reference_date: l.reference_date,
    pl: num(l.pl),
    pvp: num(l.pvp),
    dy_12m: num(l.dy_12m),
    ev_ebitda: num(l.ev_ebitda),
    roe: num(l.roe),
    margem_liquida: num(l.margem_liquida),
    dl_ebitda: num(l.dl_ebitda),
    beta: num(l.beta),
    preco_graham: l.preco_graham,
    margem_graham: num(l.margem_graham),
    preco_bazin: l.preco_bazin,
    margem_bazin: num(l.margem_bazin),
  };
}

/** Ultima linha de indicadores de cada ticker, para a tabela do comparador. */
export async function indicadoresCompletos(
  tickers: string[],
): Promise<Map<string, Record<string, number | null>>> {
  const saida = new Map<string, Record<string, number | null>>();
  for (const t of tickers) {
    const [l] = await banco()
      .select()
      .from(indicators)
      .where(eq(indicators.ticker, t))
      .orderBy(desc(indicators.reference_date))
      .limit(1);
    if (!l) continue;
    saida.set(
      t,
      Object.fromEntries(
        Object.entries(l).map(([k, v]) => [
          k,
          typeof v === "string" && /^-?\d/.test(v) ? Number(v) : null,
        ]),
      ),
    );
  }
  return saida;
}
