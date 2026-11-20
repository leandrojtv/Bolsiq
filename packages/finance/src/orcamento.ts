import { d, moeda } from "./decimal.js";

export type EstadoDoOrcamento = "ok" | "atencao" | "estourado";

/** Consumo (realizado + previsto) sobre o planejado: >= 80% atencao, > 100% estourado. */
export function estadoDoOrcamento(planejado: string, consumo: string): EstadoDoOrcamento {
  const p = d(planejado);
  const c = d(consumo);
  if (p.isZero()) return c.gt(0) ? "estourado" : "ok";
  if (c.gt(p)) return "estourado";
  return c.div(p).gte(0.8) ? "atencao" : "ok";
}

/** Media dos meses informados (os que faltam contam zero). */
export function mediaDosMeses(valores: string[], meses = 3): string {
  return moeda(
    valores
      .reduce((s, v) => s.plus(v), d(0))
      .div(meses)
      .toDecimalPlaces(2),
  );
}
