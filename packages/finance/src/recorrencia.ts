/**
 * Ocorrencias de um lancamento recorrente. Datas em YYYY-MM-DD, sem fuso: o
 * dia e o do calendario do usuario.
 */

export const FREQUENCIAS = ["mensal", "semanal", "anual"] as const;
export type Frequencia = (typeof FREQUENCIAS)[number];

export interface RegraDeRecorrencia {
  frequencia: Frequencia;
  /** Mensal e anual: dia do mes (31 vira o ultimo dia). Semanal: 1 = segunda ... 7 = domingo. */
  dia: number;
  inicio: string;
  /** Nulo: sem fim. */
  fim: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (t: Date) => t.toISOString().slice(0, 10);

export function somarDias(data: string, dias: number): string {
  const t = utc(data);
  t.setUTCDate(t.getUTCDate() + dias);
  return iso(t);
}

function noMes(ano: number, mes: number, dia: number): string {
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${pad(mes)}-${pad(Math.min(dia, ultimo))}`;
}

/** Ocorrencias entre `de` e `ate` (inclusive), dentro de inicio e fim da regra. */
export function ocorrencias(r: RegraDeRecorrencia, de: string, ate: string): string[] {
  const desde = de > r.inicio ? de : r.inicio;
  const limite = r.fim && r.fim < ate ? r.fim : ate;
  if (desde > limite) return [];
  const datas: string[] = [];
  if (r.frequencia === "semanal") {
    // getUTCDay: 0 = domingo; a regra usa 7 para domingo.
    const atual = utc(desde).getUTCDay() || 7;
    for (
      let d = somarDias(desde, (r.dia - atual + 7) % 7);
      d <= limite;
      d = somarDias(d, 7)
    )
      datas.push(d);
    return datas;
  }
  const anoInicial = Number(desde.slice(0, 4));
  const mesInicial = Number(desde.slice(5, 7));
  const mesDoAno = Number(r.inicio.slice(5, 7));
  for (let k = 0; ; k++) {
    const total = mesInicial - 1 + k;
    const ano = anoInicial + Math.floor(total / 12);
    const mes = (total % 12) + 1;
    if (`${ano}-${pad(mes)}-01` > limite) break;
    if (r.frequencia === "anual" && mes !== mesDoAno) continue;
    const d = noMes(ano, mes, r.dia);
    if (d >= desde && d <= limite) datas.push(d);
  }
  return datas;
}

/** Quantas vezes a recorrencia cai no mes (`YYYY-MM-01`): semanal da 4 ou 5. */
export function vezesNoMes(r: RegraDeRecorrencia, competencia: string): number {
  const ano = Number(competencia.slice(0, 4));
  const mes = Number(competencia.slice(5, 7));
  const fim = noMes(ano, mes, 31);
  return ocorrencias(r, competencia, fim).length;
}
