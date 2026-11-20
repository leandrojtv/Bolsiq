import type { Decimal } from "decimal.js";
import { d, moeda } from "../decimal.js";
import { somarMeses } from "../parcelamento.js";
import type { LancamentoDeInsight, TipoDeInsight } from "./tipos.js";

export function mediana(valores: Decimal[]): Decimal {
  if (valores.length === 0) return d(0);
  const v = [...valores].sort((a, b) => a.comparedTo(b));
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : v[m - 1]!.plus(v[m]!).div(2);
}

/** Desvio absoluto mediano: mediana de |x - mediana|. */
export function mad(valores: Decimal[]): Decimal {
  const m = mediana(valores);
  return mediana(valores.map((v) => v.minus(m).abs()));
}

export function diasEntre(de: string, ate: string): number {
  return Math.round(
    (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000,
  );
}

/** Primeiro dia do mes `mes` (YYYY-MM) deslocado de `n` meses. */
export const inicioDoMes = (mes: string, n = 0) => somarMeses(`${mes}-01`, n);

export function fimDoMes(mes: string): string {
  const t = new Date(`${inicioDoMes(mes, 1)}T00:00:00Z`);
  t.setUTCDate(0);
  return t.toISOString().slice(0, 10);
}

/** FNV-1a de 32 bits em base 36: id curto, estavel e sem dependencia de crypto. */
export function idDeInsight(tipo: TipoDeInsight, chave: string): string {
  let h = 0x811c9dc5;
  for (const c of new TextEncoder().encode(chave)) {
    h ^= c;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${tipo}-${h.toString(36)}`;
}

/** Despesa que aconteceu: previsto ainda nao e gasto. */
export const despesaRealizada = (l: LancamentoDeInsight) =>
  l.tipo === "despesa" && l.status !== "previsto";

export const receitaRealizada = (l: LancamentoDeInsight) =>
  l.tipo === "receita" && l.status !== "previsto";

export const soma = (ls: { valor: string }[]) =>
  ls.reduce((s, l) => s.plus(l.valor), d(0));

export const anual = (mensal: Decimal) => moeda(mensal.times(12));

export const brl = (v: Decimal | string) =>
  `R$ ${Number((typeof v === "string" ? d(v) : v).toFixed(2)).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const pct = (parte: Decimal, total: Decimal) =>
  total.isZero() ? null : Number(parte.div(total).times(100).toFixed(1));
