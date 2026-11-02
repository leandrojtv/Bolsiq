import { z } from "zod";
import { Count, IsoDate, IsoDateTime, Isin, Money, Ticker } from "../primitives.js";
import { AssetKind } from "../market.js";
import type { AnySchema } from "../openapi.js";

export interface EventDefinition {
  /** Nome versionado; é também o subject no NATS. */
  name: string;
  description: string;
  producer: string;
  consumers: string[];
  payload: AnySchema;
  /** Exemplo válido. Alimenta docs/events.md e é verificado em teste. */
  example: unknown;
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export const QuoteUpdatedV1 = z.object({
  ticker: Ticker,
  price: Money,
  /** Variação absoluta em relação ao fechamento anterior. */
  change: Money,
  ts: IsoDateTime,
});

export const DailyClosedV1 = z.object({
  date: IsoDate,
  assets_updated: Count,
});

export const DividendKind = z.enum([
  "dividendo",
  "jcp",
  "bonificacao",
  "desdobramento",
  "grupamento",
]);

export const DividendAnnouncedV1 = z.object({
  ticker: Ticker,
  kind: DividendKind,
  /** Valor por ação; nulo em desdobramento e grupamento, que usam `ratio`. */
  value_per_share: Money.nullable(),
  /** Razão do desdobramento ou grupamento, ex. "1:2"; nulo nos demais. */
  ratio: z.string().nullable(),
  ex_date: IsoDate,
  payment_date: IsoDate.nullable(),
});

export const StatementPublishedV1 = z.object({
  /** Código CVM: a demonstração é da companhia, não de um papel. */
  cvm_code: z.string().min(1),
  /** Tickers da companhia, quando conhecidos. Pode vir vazio. */
  tickers: z.array(Ticker),
  period_end: IsoDate,
  statement_kind: z.enum(["DFP", "ITR"]),
});

export const AssetListedV1 = z.object({
  ticker: Ticker,
  isin: Isin.nullable(),
  kind: AssetKind,
  name: z.string().min(1),
  listed_at: IsoDate,
});

export const AssetDelistedV1 = z.object({
  ticker: Ticker,
  kind: AssetKind,
  delisted_at: IsoDate,
  reason: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export const eventos = {
  "marketdata.quote.updated.v1": {
    name: "marketdata.quote.updated.v1",
    description:
      "Cotação de um ativo foi atualizada. Emitido a cada preço novo gravado em quotes_daily.",
    producer: "market-data",
    consumers: ["apps/web (WebSocket /v1/stream)", "alerts"],
    payload: QuoteUpdatedV1,
    example: {
      ticker: "PETR4",
      price: "38.42",
      change: "-0.58",
      ts: "2026-10-31T21:05:00Z",
    },
  },
  "marketdata.daily.closed.v1": {
    name: "marketdata.daily.closed.v1",
    description:
      "A carga diária do COTAHIST terminou. Marca o momento a partir do qual o dia está completo.",
    producer: "market-data",
    consumers: ["analytics", "portfolio"],
    payload: DailyClosedV1,
    example: { date: "2026-10-31", assets_updated: 1842 },
  },
  "marketdata.dividend.announced.v1": {
    name: "marketdata.dividend.announced.v1",
    description:
      "Provento anunciado. É o gatilho do recálculo de adj_close (job ajuste-proventos).",
    producer: "market-data",
    consumers: ["market-data (ajuste-proventos)", "portfolio", "alerts"],
    payload: DividendAnnouncedV1,
    example: {
      ticker: "PETR4",
      kind: "dividendo",
      value_per_share: "1.25",
      ratio: null,
      ex_date: "2026-11-10",
      payment_date: "2026-11-25",
    },
  },
  "marketdata.statement.published.v1": {
    name: "marketdata.statement.published.v1",
    description:
      "Demonstração financeira nova ou reapresentada foi gravada. Reapresentação também emite.",
    producer: "market-data",
    consumers: ["analytics"],
    payload: StatementPublishedV1,
    example: {
      cvm_code: "9512",
      tickers: ["PETR3", "PETR4"],
      period_end: "2026-09-30",
      statement_kind: "ITR",
    },
  },
  "marketdata.asset.listed.v1": {
    name: "marketdata.asset.listed.v1",
    description: "Ativo novo entrou no universo.",
    producer: "market-data",
    consumers: ["apps/web", "analytics"],
    payload: AssetListedV1,
    example: {
      ticker: "NEWX3",
      isin: "BRNEWXACNOR1",
      kind: "stock",
      name: "Nova Empresa",
      listed_at: "2026-10-01",
    },
  },
  "marketdata.asset.delisted.v1": {
    name: "marketdata.asset.delisted.v1",
    description: "Ativo saiu do universo. Dado histórico permanece.",
    producer: "market-data",
    consumers: ["apps/web", "analytics", "portfolio"],
    payload: AssetDelistedV1,
    example: {
      ticker: "OLDX3",
      kind: "stock",
      delisted_at: "2026-09-15",
      reason: "fechamento de capital",
    },
  },
} as const satisfies Record<string, EventDefinition>;

export type EventName = keyof typeof eventos;

export const nomesDeEventos = Object.keys(eventos) as EventName[];

/** Stream do JetStream que captura todos os eventos deste domínio. */
export const STREAM_MARKETDATA = "MARKETDATA";

/** Assunto curinga do stream. */
export const SUBJECT_MARKETDATA = "marketdata.>";

export function ehNomeDeEvento(nome: string): nome is EventName {
  return Object.prototype.hasOwnProperty.call(eventos, nome);
}

export function acharEvento(nome: string): EventDefinition | undefined {
  return ehNomeDeEvento(nome) ? eventos[nome] : undefined;
}

/**
 * Valida o payload contra o schema do evento.
 *
 * Nome desconhecido é erro, não aviso: um consumidor que recebe nome que não
 * conhece não pode decidir se o ignora com segurança.
 *
 * Não revalida o formato do nome aqui: se `acharEvento` encontrou, o nome veio
 * do catálogo, e um teste garante que todo nome do catálogo casa com
 * `EVENT_NAME_PATTERN`. Checar de novo seria ramo inalcançável.
 */
export function validarPayload(
  nome: string,
  payload: unknown,
): { ok: true; payload: unknown } | { ok: false; erro: string } {
  const definicao = acharEvento(nome);
  if (!definicao) {
    return { ok: false, erro: `evento desconhecido: ${nome}` };
  }
  const resultado = definicao.payload.safeParse(payload);
  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("; ");
    return { ok: false, erro: `payload inválido para ${nome} — ${problemas}` };
  }

  return { ok: true, payload: resultado.data };
}
