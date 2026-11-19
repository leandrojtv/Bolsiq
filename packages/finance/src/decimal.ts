import { Decimal } from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export function d(valor: string | number): Decimal {
  return new Decimal(valor);
}

/** Valor monetario como string decimal com duas casas (regra 5). */
export function moeda(valor: Decimal): string {
  return valor.toFixed(2);
}

/** Numero digitado em pt-BR ("45,90", "1.234,5", "R$ 10") para string decimal. */
export function valorDigitado(v: string): string | null {
  const limpo = v
    .trim()
    .replace(/\s|R\$/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  return /^\d+(\.\d{1,2})?$/.test(limpo) ? limpo : null;
}
