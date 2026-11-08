import { estimarTokens, LIMITE_DE_TOKENS } from "../orcamento.js";
import { SISTEMA_DE_IMPORTACAO, blocoDoDocumento } from "../../prompts/importacao-v1.js";
import type { Parte } from "./texto.js";

/**
 * Entrada de cada chamada. Pequena de proposito: a saida em JSON tem mais tokens
 * que o texto que a originou (cada linha leva origem e trecho), e entrada mais
 * saida mais o prompt ficam abaixo de LIMITE_DE_TOKENS.
 */
export const MAX_TOKENS_DE_SAIDA_NA_IMPORTACAO = 16_000;
/** Entrada por chamada: 60% da saida maxima do modelo, ate 20 mil. */
export const tokensPorLote = (maxSaida = MAX_TOKENS_DE_SAIDA_NA_IMPORTACAO): number =>
  Math.min(20_000, Math.floor(maxSaida * 0.6));
/** O que uma pagina ou imagem custa na entrada, em media, nos provedores com visao. */
export const TOKENS_POR_PAGINA_DE_IMAGEM = 1_600;

export interface Lote {
  partes: Parte[];
}

/** Pedaco grande vira varios, por linha, repetindo o cabecalho da tabela. */
function dividirParte(p: Parte, limite: number): Parte[] {
  if (estimarTokens(p.texto) <= limite) return [p];
  const linhas = p.texto.split("\n");
  const marcador = linhas[0]?.startsWith("[separador") ? 2 : 0;
  const cabecalho = linhas.slice(0, marcador);
  const pedacos: Parte[] = [];
  const base = estimarTokens(cabecalho.join("\n"));
  let atual: string[] = [...cabecalho];
  let tokens = base;
  for (const linha of linhas.slice(marcador)) {
    const t = estimarTokens(linha) + 1;
    if (tokens + t > limite && atual.length > cabecalho.length) {
      pedacos.push({ origem: p.origem, texto: atual.join("\n") });
      atual = [...cabecalho];
      tokens = base;
    }
    atual.push(linha);
    tokens += t;
  }
  pedacos.push({ origem: p.origem, texto: atual.join("\n") });
  return pedacos;
}

/** Junta paginas e abas pequenas no mesmo lote e divide as grandes. */
export function montarLotes(partes: Parte[], limite = tokensPorLote()): Lote[] {
  const lotes: Lote[] = [];
  let atual: Parte[] = [];
  let tokens = 0;
  for (const p of partes.flatMap((x) => dividirParte(x, limite))) {
    const t = estimarTokens(p.texto);
    if (tokens + t > limite && atual.length > 0) {
      lotes.push({ partes: atual });
      atual = [];
      tokens = 0;
    }
    atual.push(p);
    tokens += t;
  }
  if (atual.length > 0) lotes.push({ partes: atual });
  return lotes;
}

export const textoDoLote = (l: Lote): string =>
  l.partes.map((p) => blocoDoDocumento(p.origem, p.texto)).join("\n\n");

/** Entrada estimada de uma chamada, com o prompt de sistema. */
export const tokensDaChamada = (l: Lote): number =>
  estimarTokens(SISTEMA_DE_IMPORTACAO) + estimarTokens(textoDoLote(l));

/** Garante o teto do requisito: entrada mais saida abaixo de 100 mil por chamada. */
export function dentroDoLimite(
  l: Lote,
  maxSaida = MAX_TOKENS_DE_SAIDA_NA_IMPORTACAO,
): boolean {
  return tokensDaChamada(l) + maxSaida < LIMITE_DE_TOKENS;
}
