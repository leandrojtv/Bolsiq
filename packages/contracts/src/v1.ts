import { z } from "zod";
import {
  Cnpj,
  Count,
  IsoDate,
  IsoDateTime,
  Isin,
  Money,
  Provenance,
  Ticker,
} from "./primitives.js";
import { AssetKind } from "./market.js";
import { DividendKind } from "./events/catalog.js";

/**
 * Metadados de toda resposta de dados.
 *
 * `stale` diz se o dado passou do prazo de validade da fonte (a fonte falhou e
 * servimos o ultimo valor conhecido, ou o pregao mais recente ainda nao foi
 * carregado). `delay_minutes` e o atraso tipico da fonte, nao a idade do dado.
 */
export const ResponseMeta = z.object({
  source: z.string().min(1),
  fetched_at: IsoDateTime,
  license: z.string().min(1),
  stale: z.boolean(),
  delay_minutes: z.number().int().nonnegative(),
});
export type ResponseMeta = z.infer<typeof ResponseMeta>;

function resposta<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data, meta: ResponseMeta });
}

/** Ticker no path, aceito em minusculas e normalizado. */
export const TickerParam = z.object({
  ticker: z.preprocess((v) => (typeof v === "string" ? v.toUpperCase() : v), Ticker),
});

const intervalo = {
  from: IsoDate.optional(),
  to: IsoDate.optional(),
};

// ---------------------------------------------------------------------------
// Ativos
// ---------------------------------------------------------------------------

export const AssetSearchQuery = z.object({
  q: z.string().trim().min(1).max(60),
  type: AssetKind.optional(),
});

export const AssetSummary = z.object({
  ticker: Ticker,
  name: z.string(),
  kind: AssetKind,
  sector: z.string().nullable(),
});

export const AssetSearchResponse = resposta(z.array(AssetSummary).max(20));

export const AssetDetail = z.object({
  ticker: Ticker,
  isin: Isin.nullable(),
  cnpj: Cnpj.nullable(),
  cvm_code: z.string().nullable(),
  name: z.string(),
  legal_name: z.string().nullable(),
  kind: AssetKind,
  sector: z.string().nullable(),
  status: z.string().nullable(),
  provenance: Provenance,
});

export const AssetDetailResponse = resposta(AssetDetail);

// ---------------------------------------------------------------------------
// Cotacao corrente
// ---------------------------------------------------------------------------

export const MAX_TICKERS_POR_CONSULTA = 20;

export const QuotesParams = z.object({
  tickers: z
    .string()
    .min(1)
    .describe(`Tickers separados por virgula, ate ${MAX_TICKERS_POR_CONSULTA}`),
});

export const LiveQuote = z.object({
  ticker: Ticker,
  price: Money,
  change: Money,
  change_percent: Money,
  previous_close: Money.nullable(),
  open: Money.nullable(),
  high: Money.nullable(),
  low: Money.nullable(),
  volume: Count.nullable(),
  quoted_at: IsoDateTime,
  stale: z.boolean(),
  provenance: Provenance,
});

export const QuotesResponse = resposta(z.array(LiveQuote));

// ---------------------------------------------------------------------------
// Historico
// ---------------------------------------------------------------------------

export const Interval = z.enum(["1d", "1wk", "1mo"]);

const booleanoDeQuery = z
  .enum(["true", "false"])
  .default("true")
  .transform((v) => v === "true");

export const HistoryQuery = z.object({
  interval: Interval.default("1d"),
  ...intervalo,
  adjusted: booleanoDeQuery,
});

export const Candle = z.object({
  /** Primeiro pregao do periodo (dia, semana ou mes). */
  date: IsoDate,
  open: Money,
  high: Money,
  low: Money,
  close: Money,
  volume: Count,
  financial_volume: Money,
});

export const HistoryResponse = resposta(
  z.object({
    ticker: Ticker,
    interval: Interval,
    adjusted: z.boolean(),
    candles: z.array(Candle),
  }),
);

// ---------------------------------------------------------------------------
// Proventos
// ---------------------------------------------------------------------------

export const RangeQuery = z.object(intervalo);

export const Dividend = z.object({
  ticker: Ticker,
  kind: DividendKind,
  ex_date: IsoDate,
  payment_date: IsoDate.nullable(),
  approved_on: IsoDate.nullable(),
  value_per_share: Money.nullable(),
  /** Multiplicador de acoes em desdobramento, grupamento e bonificacao. */
  factor: Money.nullable(),
  ratio: z.string().nullable(),
});

export const DividendsResponse = resposta(z.array(Dividend));

// ---------------------------------------------------------------------------
// Fundamentos
// ---------------------------------------------------------------------------

export const FundamentalsQuery = z.object({
  period: z.enum(["annual", "quarterly"]).default("annual"),
});

/**
 * Contas usadas pelos indicadores, ja na escala de unidades.
 *
 * Nula quando a companhia nao informa a conta (banco nao tem resultado bruto,
 * por exemplo). Zero seria afirmar um valor que a fonte nao deu.
 */
export const FundamentalsPeriod = z.object({
  reference_date: IsoDate,
  period_start: IsoDate.nullable(),
  statement_kind: z.enum(["DFP", "ITR"]),
  consolidated: z.boolean(),
  revenue: Money.nullable(),
  gross_profit: Money.nullable(),
  ebit: Money.nullable(),
  net_income: Money.nullable(),
  depreciation_amortization: Money.nullable(),
  total_assets: Money.nullable(),
  current_assets: Money.nullable(),
  cash_and_equivalents: Money.nullable(),
  current_liabilities: Money.nullable(),
  equity: Money.nullable(),
  gross_debt: Money.nullable(),
  /** Acoes emitidas menos tesouraria, como a CVM publica. */
  shares_outstanding: Count.nullable(),
  version: z.number().int().positive(),
});

export const FundamentalsResponse = resposta(
  z.object({
    ticker: Ticker,
    cvm_code: z.string(),
    cnpj: Cnpj,
    period: z.enum(["annual", "quarterly"]),
    periods: z.array(FundamentalsPeriod),
  }),
);

// ---------------------------------------------------------------------------
// Macro
// ---------------------------------------------------------------------------

export const MacroSeriesName = z.enum(["cdi", "selic", "ipca", "igpm", "ibov"]);

export const MacroParams = z.object({
  serie: z.preprocess(
    (v) => (typeof v === "string" ? v.toLowerCase() : v),
    MacroSeriesName,
  ),
});

export const MacroResponse = resposta(
  z.object({
    series: MacroSeriesName,
    unit: z.string(),
    frequency: z.enum(["daily", "monthly"]),
    points: z.array(z.object({ date: IsoDate, value: Money })),
  }),
);

// ---------------------------------------------------------------------------
// Fundos (CVM)
// ---------------------------------------------------------------------------

/** CNPJ da classe no path, aceito com ou sem pontuacao. */
export const CnpjParam = z.object({
  cnpj: z.preprocess((v) => (typeof v === "string" ? v.replace(/\D/g, "") : v), Cnpj),
});

export const FundSearchQuery = z.object({
  q: z.string().trim().min(2).max(80),
});

export const FundSummary = z.object({
  cnpj: Cnpj,
  name: z.string(),
  class_type: z.string().nullable(),
  classification: z.string().nullable(),
  status: z.string().nullable(),
});

export const FundSearchResponse = resposta(z.array(FundSummary).max(20));

export const FundDetail = FundSummary.extend({
  anbima_class: z.string().nullable(),
  aum: Money.nullable(),
  aum_date: IsoDate.nullable(),
  provenance: Provenance,
});

export const FundDetailResponse = resposta(FundDetail);

export const FundHistoryResponse = resposta(
  z.object({
    cnpj: Cnpj,
    points: z.array(
      z.object({
        date: IsoDate,
        /** Valor da cota. */
        nav: Money,
        /** Patrimonio liquido. */
        aum: Money,
        holders: Count.nullable(),
      }),
    ),
  }),
);

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const JobRun = z.object({
  id: z.string(),
  state: z.string(),
  created_on: IsoDateTime,
  completed_on: IsoDateTime.nullable(),
});

export const JobInfo = z.object({
  name: z.string(),
  description: z.string(),
  cron: z.string().nullable(),
  queued: Count,
  last_run: JobRun.nullable(),
});

export const JobsResponse = z.object({ data: z.array(JobInfo) });

export const JobNameParam = z.object({ name: z.string().min(1) });

export const TriggerJobBody = z
  .object({ data: z.record(z.string(), z.unknown()).optional() })
  .default({});

export const TriggerJobResponse = z.object({
  data: z.object({ job_id: z.string(), name: z.string() }),
});

export type AssetSummary = z.infer<typeof AssetSummary>;
export type AssetDetail = z.infer<typeof AssetDetail>;
export type LiveQuote = z.infer<typeof LiveQuote>;
export type Candle = z.infer<typeof Candle>;
export type Interval = z.infer<typeof Interval>;
export type Dividend = z.infer<typeof Dividend>;
export type FundamentalsPeriod = z.infer<typeof FundamentalsPeriod>;
export type MacroSeriesName = z.infer<typeof MacroSeriesName>;
export type JobInfo = z.infer<typeof JobInfo>;
export type FundSummary = z.infer<typeof FundSummary>;
export type FundDetail = z.infer<typeof FundDetail>;
