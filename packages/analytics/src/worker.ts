import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@bolsiq/db-core";
import { assinar, type Assinatura, type Messaging } from "@bolsiq/messaging";
import {
  AssetDetailResponse,
  DividendsResponse,
  FundamentalsResponse,
  HistoryResponse,
  MacroResponse,
  type AnySchema,
} from "@bolsiq/contracts";
import type { z } from "zod";
import {
  assets_mirror,
  deadLetter,
  indicators,
  processedEvents,
  recalc_queue,
} from "./db/schema.js";
import { recalcular, type Ponto } from "./recalculo.js";

export type Log = (nivel: string, msg: string, ctx?: Record<string, unknown>) => void;
export type Buscar = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Cliente do /v1. O analytics le dado de mercado pela API, nunca pelo schema
 * market_data (ADR 0009). A resposta e validada pelo mesmo schema que gera o
 * OpenAPI: contrato quebrado falha aqui, alto, e nao vira indicador errado.
 */
export function clienteDoMarketData(base: string, buscar: Buscar = fetch) {
  async function obter<S extends AnySchema>(
    caminho: string,
    schema: S,
  ): Promise<z.infer<S> | null> {
    const res = await buscar(`${base}${caminho}`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`market-data respondeu ${res.status} em ${caminho}`);
    return schema.parse(await res.json());
  }
  return {
    ativo: (t: string) => obter(`/v1/assets/${t}`, AssetDetailResponse),
    historico: (t: string, ajustado: boolean) =>
      obter(`/v1/history/${t}?adjusted=${ajustado}`, HistoryResponse),
    fundamentos: (t: string) =>
      obter(`/v1/fundamentals/${t}?period=annual`, FundamentalsResponse),
    proventos: (t: string, de: string) =>
      obter(`/v1/dividends/${t}?from=${de}`, DividendsResponse),
    macro: (serie: "cdi" | "ibov") => obter(`/v1/macro/${serie}`, MacroResponse),
  };
}

export type ClienteDoMarketData = ReturnType<typeof clienteDoMarketData>;

function hojeEmSp(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    new Date(),
  );
}

/** Enfileira recalculos; pendente repetido do mesmo ticker e ignorado. */
async function enfileirar(
  tx: Pick<Db, "insert">,
  tickers: string[],
  motivo: string,
  eventId: string | null,
): Promise<void> {
  if (tickers.length === 0) return;
  await tx
    .insert(recalc_queue)
    .values(
      tickers.map((ticker) => ({ id: randomUUID(), ticker, motivo, event_id: eventId })),
    )
    .onConflictDoNothing({
      target: recalc_queue.ticker,
      where: sql`processado_em IS NULL`,
    });
}

/**
 * Recalcula um ticker: le o /v1, calcula e grava espelho e indicadores.
 *
 * Macro (CDI e IBOV) e igual para todos os tickers de uma rodada; o chamador
 * passa uma vez em vez de cada recalculo pedir de novo.
 */
export async function recalcularTicker(
  db: Db,
  cliente: ClienteDoMarketData,
  ticker: string,
  macro: { cdi: Ponto[]; ibov: Ponto[] },
): Promise<"ok" | "sem_ativo" | "sem_preco"> {
  const ativo = await cliente.ativo(ticker);
  if (!ativo) {
    await db
      .update(assets_mirror)
      .set({ listed: "false" })
      .where(eq(assets_mirror.ticker, ticker));
    return "sem_ativo";
  }
  const a = ativo.data;
  const espelho = {
    ticker,
    name: a.name,
    kind: a.kind,
    sector: a.sector,
    cvm_code: a.cvm_code,
    listed: "true",
    atualizado_em: new Date().toISOString(),
  };
  await db
    .insert(assets_mirror)
    .values(espelho)
    .onConflictDoUpdate({ target: assets_mirror.ticker, set: espelho });

  const hoje = hojeEmSp();
  const cincoAnos = `${Number(hoje.slice(0, 4)) - 6}-01-01`;
  const [brutas, ajustadas, fundamentos, proventos] = await Promise.all([
    cliente.historico(ticker, false),
    cliente.historico(ticker, true),
    a.cvm_code ? cliente.fundamentos(ticker) : Promise.resolve(null),
    cliente.proventos(ticker, cincoAnos),
  ]);

  const linha = recalcular({
    ticker,
    kind: a.kind,
    anuais: fundamentos?.data.periods ?? [],
    velasBrutas: brutas?.data.candles ?? [],
    velasAjustadas: ajustadas?.data.candles ?? [],
    proventos: proventos?.data ?? [],
    cdi: macro.cdi,
    ibov: macro.ibov,
    hoje,
  });
  if (!linha) return "sem_preco";

  const valores = { ...linha, calculado_em: new Date().toISOString() };
  await db
    .insert(indicators)
    .values(valores as typeof indicators.$inferInsert)
    .onConflictDoUpdate({
      target: [indicators.ticker, indicators.reference_date],
      set: valores,
    });
  return "ok";
}

export interface WorkerDeAnalytics {
  parar: () => Promise<void>;
  /** Processa a fila ate esvaziar; usado em teste. */
  drenar: () => Promise<number>;
}

export async function iniciarWorkerDeAnalytics(deps: {
  db: Db;
  messaging: Messaging;
  cliente: ClienteDoMarketData;
  log: Log;
  concorrencia?: number;
  intervaloMs?: number;
}): Promise<WorkerDeAnalytics> {
  const { db, cliente, log } = deps;
  const tabelas = { processedEvents, deadLetter };

  const assinatura: Assinatura = await assinar({
    messaging: deps.messaging,
    db,
    consumidor: "analytics-marketdata",
    tabelas,
    manipular: async ({ evento, payload, tx }) => {
      const p = payload as Record<string, unknown>;
      switch (evento.name) {
        case "marketdata.asset.listed.v1":
          await enfileirar(tx, [p.ticker as string], "asset.listed", evento.id);
          break;
        case "marketdata.asset.delisted.v1":
          await tx
            .update(assets_mirror)
            .set({ listed: "false" })
            .where(eq(assets_mirror.ticker, p.ticker as string));
          break;
        case "marketdata.statement.published.v1":
          await enfileirar(tx, p.tickers as string[], "statement.published", evento.id);
          break;
        case "marketdata.daily.closed.v1":
        case "marketdata.dividend.announced.v1": {
          // Preco novo muda P/L, DY e desempenho de todo o universo.
          const todos =
            evento.name === "marketdata.daily.closed.v1"
              ? (
                  await tx
                    .select({ t: assets_mirror.ticker })
                    .from(assets_mirror)
                    .where(eq(assets_mirror.listed, "true"))
                ).map((r) => r.t)
              : [p.ticker as string];
          await enfileirar(tx, todos, evento.name.slice(11, -3), evento.id);
          break;
        }
        default:
          break;
      }
    },
    aoFalhar: (erro, ctx) => {
      if (ctx.nivel === "debug") return;
      log("error", "falha ao consumir evento", { erro: erro.message, ...ctx });
    },
  });

  let macroCache: { em: number; cdi: Ponto[]; ibov: Ponto[] } | null = null;
  async function macro() {
    if (macroCache && Date.now() - macroCache.em < 3_600_000) return macroCache;
    const [cdi, ibov] = await Promise.all([cliente.macro("cdi"), cliente.macro("ibov")]);
    macroCache = {
      em: Date.now(),
      cdi: cdi?.data.points ?? [],
      ibov: ibov?.data.points ?? [],
    };
    return macroCache;
  }

  /** Pega e processa um item da fila. `false` quando a fila esta vazia. */
  async function processarUm(): Promise<boolean> {
    const [item] = await db.transaction(async (tx) => {
      const r = await tx.execute<{ id: string; ticker: string }>(sql`
        SELECT id, ticker FROM analytics.recalc_queue
        WHERE processado_em IS NULL AND tentativas < 5
        ORDER BY enfileirado_em
        LIMIT 1 FOR UPDATE SKIP LOCKED`);
      const linha = r.rows[0];
      if (linha) {
        await tx
          .update(recalc_queue)
          .set({ tentativas: sql`${recalc_queue.tentativas} + 1` })
          .where(eq(recalc_queue.id, linha.id));
      }
      return r.rows;
    });
    if (!item) return false;

    try {
      const resultado = await recalcularTicker(db, cliente, item.ticker, await macro());
      await db
        .update(recalc_queue)
        .set({ processado_em: new Date().toISOString() })
        .where(and(eq(recalc_queue.id, item.id), isNull(recalc_queue.processado_em)));
      if (resultado !== "ok")
        log("debug", "recalculo sem indicador", { ticker: item.ticker, resultado });
    } catch (erro) {
      log("warn", "recalculo falhou", {
        ticker: item.ticker,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }
    return true;
  }

  async function drenar(): Promise<number> {
    let n = 0;
    const concorrencia = deps.concorrencia ?? 4;
    let vazio = false;
    await Promise.all(
      Array.from({ length: concorrencia }, async () => {
        while (!vazio) {
          if (await processarUm()) n++;
          else vazio = true;
        }
      }),
    );
    return n;
  }

  let ativo = true;
  const laco = (async () => {
    while (ativo) {
      try {
        const n = await drenar();
        if (n > 0) log("info", "recalculos processados", { n });
      } catch (erro) {
        log("error", "rodada de recalculo falhou", { erro: String(erro) });
      }
      await new Promise((r) => setTimeout(r, deps.intervaloMs ?? 2000));
    }
  })();

  return {
    drenar,
    async parar() {
      ativo = false;
      await assinatura.parar();
      await laco;
    },
  };
}
