/**
 * Converte data do SGS do Banco Central para `YYYY-MM-DD`.
 *
 * A API devolve `dd/MM/yyyy`. Passar isso para `new Date()` faz o JavaScript
 * interpretar como `MM/dd`, e os doze primeiros dias de cada mês trocam de mês
 * em silêncio — `01/02/2026` vira 1º de fevereiro em vez de 2 de janeiro.
 */
export function parseBcbDate(valor: string): string {
  const achado = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor.trim());
  if (!achado) {
    throw new Error(`data do BCB em formato inesperado: ${valor}`);
  }

  const [, dia = "", mes = "", ano = ""] = achado;
  const mesNum = Number(mes);
  const diaNum = Number(dia);

  if (mesNum < 1 || mesNum > 12 || diaNum < 1 || diaNum > 31) {
    throw new Error(`data do BCB inválida: ${valor}`);
  }

  return `${ano}-${mes}-${dia}`;
}

/** Séries do SGS usadas como benchmark, verificadas na API em 2026-11-01. */
export const SERIES_SGS = {
  selicDiaria: { code: "11", unit: "% no dia útil", frequency: "daily" },
  cdiDiario: { code: "12", unit: "% no dia útil", frequency: "daily" },
  selicMeta: { code: "432", unit: "% a.a.", frequency: "daily" },
  ipcaMensal: { code: "433", unit: "% no mês", frequency: "monthly" },
  igpmMensal: { code: "189", unit: "% no mês", frequency: "monthly" },
} as const;

/**
 * Fatia um intervalo em janelas de no máximo `anos`.
 *
 * O SGS devolve HTTP 406 para janela longa em série diária. Fatiar é a
 * resposta correta; aumentar o número de tentativas não é.
 */
export function janelasDeConsulta(
  inicio: string,
  fim: string,
  anos = 3,
): { from: string; to: string }[] {
  const dataInicio = new Date(`${inicio}T00:00:00Z`);
  const dataFim = new Date(`${fim}T00:00:00Z`);

  if (Number.isNaN(dataInicio.getTime()) || Number.isNaN(dataFim.getTime())) {
    throw new Error(`intervalo inválido: ${inicio} a ${fim}`);
  }
  if (dataInicio > dataFim) {
    throw new Error(`início posterior ao fim: ${inicio} a ${fim}`);
  }

  const janelas: { from: string; to: string }[] = [];
  let cursor = dataInicio;

  while (cursor <= dataFim) {
    const limite = new Date(cursor);
    limite.setUTCFullYear(limite.getUTCFullYear() + anos);
    limite.setUTCDate(limite.getUTCDate() - 1);

    const to = limite < dataFim ? limite : dataFim;
    janelas.push({ from: isoDia(cursor), to: isoDia(to) });

    const proximo = new Date(to);
    proximo.setUTCDate(proximo.getUTCDate() + 1);
    cursor = proximo;
  }

  return janelas;
}

function isoDia(data: Date): string {
  return data.toISOString().slice(0, 10);
}
