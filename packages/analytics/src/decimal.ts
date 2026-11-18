import { Decimal } from "decimal.js";

// 28 digitos cobre com folga balanco de trilhao com centavos.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export function d(valor: string | number): Decimal {
  return new Decimal(valor);
}

/**
 * Divisao que devolve null quando o denominador e zero.
 *
 * Indicador com denominador zero nao e infinito nem zero: e indefinido. P/L de
 * empresa sem lucro, DL/EBITDA de empresa sem EBITDA. Devolver um numero ali
 * faria o screener ordenar por um valor que nao existe.
 */
export function dividir(numerador: Decimal, denominador: Decimal): Decimal | null {
  return denominador.isZero() ? null : numerador.div(denominador);
}

/** Converte para number, para indicadores adimensionais (razoes, percentuais). */
export function paraNumero(valor: Decimal | null, casas = 6): number | null {
  return valor === null ? null : Number(valor.toFixed(casas));
}

/** Converte para string decimal, para valores monetarios (regra 5). */
export function paraMoeda(valor: Decimal | null, casas = 2): string | null {
  return valor === null ? null : valor.toFixed(casas);
}
