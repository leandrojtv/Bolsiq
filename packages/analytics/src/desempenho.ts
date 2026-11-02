/** Dias uteis por ano usados na anualizacao. */
export const DIAS_UTEIS_ANO = 252;

export interface Desempenho {
  retorno_periodo: number | null;
  volatilidade_anual: number | null;
  drawdown_maximo: number | null;
  sharpe: number | null;
  beta: number | null;
}

/**
 * Retorno acumulado composto da serie.
 *
 * Produto de (1 + r), nao soma: somar retornos diarios erra quanto maior a
 * janela e a volatilidade.
 */
export function retornoAcumulado(retornos: number[]): number | null {
  if (retornos.length === 0) return null;
  return arredondar(retornos.reduce((acc, r) => acc * (1 + r), 1) - 1);
}

/** Desvio padrao amostral, anualizado por raiz de 252. */
export function volatilidadeAnual(retornos: number[]): number | null {
  if (retornos.length < 2) return null;

  const media = retornos.reduce((a, b) => a + b, 0) / retornos.length;
  // Denominador n-1: amostra, nao populacao. Com n pequeno a diferenca e
  // material, e serie de retorno e sempre amostra.
  const variancia =
    retornos.reduce((acc, r) => acc + (r - media) ** 2, 0) / (retornos.length - 1);

  return arredondar(Math.sqrt(variancia) * Math.sqrt(DIAS_UTEIS_ANO));
}

/**
 * Maior queda do pico ao vale, em fracao negativa.
 *
 * Calculado sobre a serie acumulada, nao sobre os retornos diarios: o pior dia
 * nao e o pior momento. Devolve 0 quando a serie so sobe.
 */
export function drawdownMaximo(retornos: number[]): number | null {
  if (retornos.length === 0) return null;

  let acumulado = 1;
  let pico = 1;
  let pior = 0;

  for (const r of retornos) {
    acumulado *= 1 + r;
    if (acumulado > pico) pico = acumulado;
    const queda = acumulado / pico - 1;
    if (queda < pior) pior = queda;
  }

  return arredondar(pior);
}

/**
 * Sharpe anualizado usando o CDI como taxa livre de risco.
 *
 * O excesso e calculado dia a dia contra o CDI do mesmo dia, nao contra uma
 * taxa media: a Selic muda no periodo, e usar a media distorce o indicador
 * justamente em janelas de mudanca de juros, que e quando ele importa.
 */
export function sharpe(ativo: number[], cdi: number[]): number | null {
  if (ativo.length < 2 || ativo.length !== cdi.length) return null;

  const excesso = ativo.map((r, i) => r - (cdi[i] ?? 0));
  const media = excesso.reduce((a, b) => a + b, 0) / excesso.length;
  const vol = volatilidadeAnual(excesso);

  if (vol === null || vol === 0) return null;
  return arredondar((media * DIAS_UTEIS_ANO) / vol);
}

/**
 * Beta contra o IBOV: covariancia(ativo, indice) / variancia(indice).
 */
export function beta(ativo: number[], indice: number[]): number | null {
  if (ativo.length < 2 || ativo.length !== indice.length) return null;

  const mediaA = ativo.reduce((a, b) => a + b, 0) / ativo.length;
  const mediaI = indice.reduce((a, b) => a + b, 0) / indice.length;

  let cov = 0;
  let varI = 0;
  for (let i = 0; i < ativo.length; i++) {
    const da = (ativo[i] ?? 0) - mediaA;
    const di = (indice[i] ?? 0) - mediaI;
    cov += da * di;
    varI += di * di;
  }

  if (varI === 0) return null;
  return arredondar(cov / varI);
}

export function desempenho(serie: {
  ativo: number[];
  cdi?: number[] | undefined;
  ibov?: number[] | undefined;
}): Desempenho {
  return {
    retorno_periodo: retornoAcumulado(serie.ativo),
    volatilidade_anual: volatilidadeAnual(serie.ativo),
    drawdown_maximo: drawdownMaximo(serie.ativo),
    sharpe: serie.cdi ? sharpe(serie.ativo, serie.cdi) : null,
    beta: serie.ibov ? beta(serie.ativo, serie.ibov) : null,
  };
}

function arredondar(v: number): number {
  return Number(v.toFixed(6));
}
