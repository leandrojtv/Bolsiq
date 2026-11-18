import { z } from "zod";
import { Cnpj, Count, IsoDate, Isin, Money, Provenance, Ticker } from "./primitives.js";

export const AssetKind = z.enum(["stock", "fii", "bdr", "etf", "fund"]);

export const Asset = z.object({
  ticker: Ticker.nullable(),
  isin: Isin.nullable(),
  cnpj: Cnpj.nullable(),
  cvm_code: z.string().nullable(),
  name: z.string(),
  legal_name: z.string().nullable(),
  kind: AssetKind,
  sector: z.string().nullable(),
  status: z.string().nullable(),
});

export const Quote = z.object({
  ticker: Ticker,
  date: IsoDate,
  open: Money,
  high: Money,
  low: Money,
  close: Money,
  average: Money.nullable(),
  /** Fechamento ajustado por proventos; calculado, não vem da fonte. */
  adj_close: Money.nullable(),
  volume: Count,
  trades: Count,
  financial_volume: Money,
  provenance: Provenance,
});

export const FundDaily = z.object({
  cnpj_fundo: Cnpj,
  date: IsoDate,
  nav: Money,
  aum: Money,
  inflows: Money.nullable(),
  outflows: Money.nullable(),
  holders: Count.nullable(),
  provenance: Provenance,
});

export const StatementType = z.enum(["BPA", "BPP", "DRE", "DFC", "DMPL", "DVA"]);

export const FinancialStatementLine = z.object({
  cvm_code: z.string(),
  cnpj: Cnpj,
  reference_date: IsoDate,
  period_start: IsoDate.nullable(),
  period_end: IsoDate.nullable(),
  statement_type: StatementType,
  is_consolidated: z.boolean(),
  account_code: z.string(),
  account_label: z.string(),
  /** Já normalizado pela ESCALA_MOEDA da CVM: sempre em unidades. */
  amount: Money,
  currency: z.string(),
  version: z.number().int().positive(),
  provenance: Provenance,
});

export const MacroSeriesPoint = z.object({
  series_code: z.string(),
  date: IsoDate,
  value: Money,
  unit: z.string(),
  frequency: z.enum(["daily", "monthly"]),
  provenance: Provenance,
});

export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  role: z.enum(["api", "worker", "all"]),
  version: z.string(),
  checks: z.record(z.string(), z.enum(["ok", "fail"])),
});

export type Asset = z.infer<typeof Asset>;
export type Quote = z.infer<typeof Quote>;
export type FundDaily = z.infer<typeof FundDaily>;
export type FinancialStatementLine = z.infer<typeof FinancialStatementLine>;
export type MacroSeriesPoint = z.infer<typeof MacroSeriesPoint>;
export type HealthResponse = z.infer<typeof HealthResponse>;
