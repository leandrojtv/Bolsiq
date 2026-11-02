import { Decimal } from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export function d(valor: string | number): Decimal {
  return new Decimal(valor);
}

export function dividir(n: Decimal, den: Decimal): Decimal | null {
  return den.isZero() ? null : n.div(den);
}

/** Valor monetario como string decimal (regra 5). */
export function moeda(valor: Decimal, casas = 2): string {
  return valor.toFixed(casas);
}

/** Quantidade: oito casas, porque FII e fundo tem fracionario. */
export function qtd(valor: Decimal): string {
  return valor.toFixed(8);
}

export function numero(valor: Decimal | null, casas = 8): number | null {
  return valor === null ? null : Number(valor.toFixed(casas));
}
