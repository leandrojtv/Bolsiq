import type {
  AssetDetail,
  Dividend,
  FundamentalsPeriod,
  LiveQuote,
} from "@bolsiq/contracts";
import type { Envelope } from "@/lib/api";

export const TIPO_DO_ATIVO: Record<string, string> = {
  stock: "Ação",
  fii: "FII",
  bdr: "BDR",
  etf: "ETF",
  fund: "Fundo",
};

/** Nome legivel da fonte para a linha "Fonte: ...". */
export function nomeDaFonte(source: string): string {
  if (source.startsWith("brapi")) return "B3 via brapi";
  if (source.startsWith("b3-cotahist")) return "B3 COTAHIST";
  if (source.startsWith("cvm")) return "CVM";
  if (source.startsWith("bcb")) return "Banco Central";
  return source;
}

export interface Fundamentos {
  ticker: string;
  cvm_code: string;
  cnpj: string;
  period: "annual" | "quarterly";
  periods: FundamentalsPeriod[];
}

export interface DadosDoAtivo {
  ativo: Envelope<AssetDetail>;
  cotacao: Envelope<LiveQuote[]> | null;
  proventos: Envelope<Dividend[]> | null;
  fundamentos: Envelope<Fundamentos> | null;
}
