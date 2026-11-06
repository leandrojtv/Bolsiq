import { d } from "./decimal.js";
import { drawdownMaximo, retornoAcumulado, volatilidadeAnual } from "./desempenho.js";
import type { IndicadorFiltravel } from "./screener.js";

export interface PontoDeNivel {
  date: string;
  valor: number;
}

/**
 * Qual valor e o melhor em cada indicador.
 *
 * - `maior` e `menor`: o obvio.
 * - `menor_positivo`: multiplos de preco (P/L, P/VP, EV/EBITDA). O menor e o
 *   mais barato, mas so entre os positivos: P/L negativo e prejuizo, nao
 *   pechincha.
 * - ausente: nao ha melhor (beta depende do que o investidor quer).
 *
 * A regra mora aqui, e nao no front, para o screener, o comparador e um
 * cliente da API concordarem.
 */
export type Sentido = "maior" | "menor" | "menor_positivo";

export const SENTIDO: Partial<Record<IndicadorFiltravel, Sentido>> = {
  pl: "menor_positivo",
  pvp: "menor_positivo",
  ev_ebitda: "menor_positivo",
  ev_ebit: "menor_positivo",
  p_receita: "menor_positivo",
  dy_12m: "maior",
  dy_medio_5a: "maior",
  roe: "maior",
  roic: "maior",
  roa: "maior",
  margem_bruta: "maior",
  margem_ebitda: "maior",
  margem_liquida: "maior",
  dl_ebitda: "menor",
  dl_pl: "menor",
  liquidez_corrente: "maior",
  cagr_receita_5a: "maior",
  cagr_lucro_5a: "maior",
  margem_graham: "maior",
  margem_bazin: "maior",
  volatilidade_anual: "menor",
  // Fracao negativa: -0,10 e melhor que -0,35.
  drawdown_maximo: "maior",
  sharpe: "maior",
  liquidez_diaria: "maior",
  patrimonio_liquido: "maior",
  cotistas: "maior",
};

/**
 * Indices dos melhores valores da linha (empate marca todos). Vazio quando o
 * indicador nao tem sentido definido ou nenhum valor se qualifica.
 */
export function melhoresDaLinha(
  indicador: IndicadorFiltravel,
  valores: (number | null)[],
): number[] {
  const sentido = SENTIDO[indicador];
  if (!sentido) return [];
  const candidatos = valores
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v !== null && Number.isFinite(x.v))
    .filter((x) => sentido !== "menor_positivo" || x.v > 0);
  if (candidatos.length < 2) return [];
  const alvo =
    sentido === "maior"
      ? Math.max(...candidatos.map((x) => x.v))
      : Math.min(...candidatos.map((x) => x.v));
  return candidatos.filter((x) => x.v === alvo).map((x) => x.i);
}

/** Indicadores da tabela do comparador, na ordem e com o formato de exibicao. */
export const LINHAS_DO_COMPARADOR: {
  indicador: IndicadorFiltravel;
  rotulo: string;
  formato: "razao" | "percentual" | "moeda";
}[] = [
  { indicador: "pl", rotulo: "P/L", formato: "razao" },
  { indicador: "pvp", rotulo: "P/VP", formato: "razao" },
  { indicador: "dy_12m", rotulo: "DY 12m", formato: "percentual" },
  { indicador: "roe", rotulo: "ROE", formato: "percentual" },
  { indicador: "margem_liquida", rotulo: "Margem líquida", formato: "percentual" },
  { indicador: "dl_ebitda", rotulo: "DL/EBITDA", formato: "razao" },
  { indicador: "margem_graham", rotulo: "Graham: margem", formato: "percentual" },
  { indicador: "margem_bazin", rotulo: "Bazin: margem", formato: "percentual" },
  { indicador: "sharpe", rotulo: "Sharpe (CDI)", formato: "razao" },
  { indicador: "beta", rotulo: "Beta (IBOV)", formato: "razao" },
];

/** Normaliza a serie para comecar em 100. */
export function base100(pontos: PontoDeNivel[]): PontoDeNivel[] {
  const inicio = pontos[0]?.valor;
  if (!inicio || inicio <= 0) return [];
  return pontos.map((p) => ({
    date: p.date,
    valor: Number(((p.valor / inicio) * 100).toFixed(4)),
  }));
}

/**
 * Nivel acumulado de uma taxa por periodo em percentual (CDI do SGS em % ao
 * dia, IPCA em % ao mes): produto de (1 + taxa/100). Decimal na composicao
 * para nao acumular erro de ponto flutuante em mil multiplicacoes.
 */
export function nivelDeTaxa(taxas: { date: string; value: string }[]): PontoDeNivel[] {
  let nivel = d(1);
  return taxas.map((t) => {
    nivel = nivel.times(d(1).plus(d(t.value).div(100)));
    return { date: t.date, valor: nivel.toNumber() };
  });
}

export interface Estatisticas {
  retorno: number | null;
  volatilidade_anual: number | null;
  drawdown_maximo: number | null;
}

/**
 * Retorno, volatilidade e drawdown de uma serie de niveis.
 *
 * Volatilidade so para serie diaria: anualizar por raiz de 252 uma serie
 * mensal (IPCA) daria um numero sem sentido.
 */
export function estatisticas(pontos: PontoDeNivel[], diaria = true): Estatisticas {
  const retornos: number[] = [];
  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1]?.valor ?? 0;
    const b = pontos[i]?.valor ?? 0;
    if (a > 0) retornos.push(b / a - 1);
  }
  return {
    retorno: retornoAcumulado(retornos),
    volatilidade_anual: diaria ? volatilidadeAnual(retornos) : null,
    drawdown_maximo: drawdownMaximo(retornos),
  };
}

export type PeriodoDeComparacao = "6M" | "1A" | "2A" | "5A" | "Máx";

export function inicioDaComparacao(periodo: PeriodoDeComparacao, hoje: string): string {
  if (periodo === "Máx") return "1990-01-01";
  const meses = { "6M": 6, "1A": 12, "2A": 24, "5A": 60 }[periodo];
  const data = new Date(`${hoje}T00:00:00Z`);
  data.setUTCMonth(data.getUTCMonth() - meses);
  return data.toISOString().slice(0, 10);
}

/**
 * Identificador do comparador: ticker, CNPJ de fundo (14 digitos) ou indice.
 * E o que vai na URL (`/comparar?t=PETR4,HGLG11,IBOV`).
 */
export type TipoDeSerie = "ativo" | "fundo" | "indice";
export const INDICES = ["IBOV", "CDI", "IPCA"] as const;

export function tipoDoIdentificador(id: string): TipoDeSerie | null {
  if ((INDICES as readonly string[]).includes(id)) return "indice";
  if (/^\d{14}$/.test(id)) return "fundo";
  if (/^[A-Z0-9]{4,12}$/.test(id)) return "ativo";
  return null;
}

export const MAX_COMPARADOS = 6;

/** Le `?t=` da URL: maiusculas, sem repetidos, sem invalidos, ate 6. */
export function identificadoresDaUrl(t: string | null): string[] {
  const vistos = new Set<string>();
  for (const bruto of (t ?? "").split(",")) {
    const limpo = bruto.trim().toUpperCase();
    // CNPJ aceito com ou sem pontuacao: 00.017.024/0001-53 vira 00017024000153.
    const id = /^[\d./-]+$/.test(limpo) ? limpo.replace(/\D/g, "") : limpo;
    if (id && tipoDoIdentificador(id) && !vistos.has(id)) vistos.add(id);
    if (vistos.size === MAX_COMPARADOS) break;
  }
  return [...vistos];
}
