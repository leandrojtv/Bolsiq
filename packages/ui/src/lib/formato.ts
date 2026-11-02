/**
 * Formatacao numerica e de data para exibicao, em pt-BR.
 *
 * O contrato do /v1 entrega dinheiro como string decimal (regra 5). A
 * conversao para number acontece so aqui, no ultimo passo, para o Intl
 * formatar: nenhuma conta e feita com o resultado.
 */

export type Numero = number | string;

const FUSO = "America/Sao_Paulo";

function num(v: Numero): number {
  return typeof v === "number" ? v : Number(v);
}

export function formatarNumero(v: Numero, casas = 2): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(num(v));
}

export function formatarDinheiro(v: Numero, casas = 2): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })
    .format(num(v))
    .replace(/\u00a0/g, " ");
}

/** Fracao para percentual: 0.0235 vira "2,35%". */
export function formatarPercentual(
  fracao: Numero,
  opcoes: { sinal?: boolean; casas?: number } = {},
): string {
  const valor = num(fracao) * 100;
  const corpo = `${formatarNumero(Math.abs(valor), opcoes.casas ?? 2)}%`;
  if (!opcoes.sinal) return valor < 0 ? `-${corpo}` : corpo;
  return `${valor < 0 ? "-" : "+"}${corpo}`;
}

/** 1.234.000.000 vira "1,2 bi"; 48.200.000 vira "48,2 mi". */
export function formatarCompacto(v: Numero): string {
  return new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  })
    .format(num(v))
    .replace(/\u00a0/g, " ");
}

export type Direcao = "alta" | "queda" | "estavel";

export function direcaoDe(v: Numero): Direcao {
  const n = num(v);
  return n > 0 ? "alta" : n < 0 ? "queda" : "estavel";
}

/** Hora em Sao Paulo; com data quando nao e de hoje. */
export function formatarHorario(iso: string, agora: Date = new Date()): string {
  const data = new Date(iso);
  const dia = (d: Date) =>
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: FUSO,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    hour: "2-digit",
    minute: "2-digit",
  }).format(data);
  if (dia(data) === dia(agora)) return hora;
  const curta = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    day: "2-digit",
    month: "2-digit",
  }).format(data);
  return `${curta} ${hora}`;
}

/** 15 vira "15 min"; 90 vira "1 h 30 min"; 1440 vira "1 dia". */
export function formatarAtraso(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 1440) {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
  const d = Math.round(minutos / 1440);
  return d === 1 ? "1 dia" : `${d} dias`;
}
