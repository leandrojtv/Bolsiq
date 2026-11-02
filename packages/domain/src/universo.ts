import { TPMERC_A_VISTA } from "./cotahist.js";

export type TipoDeAtivo = "stock" | "fii" | "etf" | "bdr";

/**
 * CODBDI que entram no universo, e o tipo de cada um.
 *
 * Fora daqui ficam opcoes (78, 82), termo, leilao, fracionario (96), direitos
 * e recibos. Conferido contra o COTAHIST_A2024: 02 traz ON/PN/UNT, 12 os FIIs,
 * 14 os ETFs e 34 a 36 os BDRs.
 */
const TIPO_POR_CODBDI: Record<string, TipoDeAtivo> = {
  "02": "stock",
  "12": "fii",
  "14": "etf",
  "33": "bdr",
  "34": "bdr",
  "35": "bdr",
  "36": "bdr",
};

/** Tipo do papel no universo, ou `null` quando o registro fica de fora. */
export function classificarCotahist(codbdi: string, tpmerc: string): TipoDeAtivo | null {
  if (tpmerc !== TPMERC_A_VISTA) return null;
  return TIPO_POR_CODBDI[codbdi] ?? null;
}

/** Classe do papel sem o segmento de governanca: "ON      NM" vira "ON". */
export function classeDaEspecificacao(especificacao: string): string {
  return especificacao.trim().split(/\s+/)[0] ?? "";
}
