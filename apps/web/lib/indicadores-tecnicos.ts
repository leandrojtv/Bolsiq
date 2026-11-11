// Mesmas formulas que o assistente usa: ficam no analytics para nao divergir.
export { ifr, mediaMovel } from "@bolsiq/analytics/puro";

export type Periodo = "1M" | "6M" | "1A" | "5A" | "Máx";

/** Data inicial do periodo, em YYYY-MM-DD, contada a partir de `hoje`. */
export function inicioDoPeriodo(periodo: Periodo, hoje: string): string {
  const d = new Date(`${hoje}T00:00:00Z`);
  if (periodo === "Máx") return "1990-01-01";
  const meses = { "1M": 1, "6M": 6, "1A": 12, "5A": 60 }[periodo];
  d.setUTCMonth(d.getUTCMonth() - meses);
  return d.toISOString().slice(0, 10);
}

export function hojeEmSp(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    agora,
  );
}
