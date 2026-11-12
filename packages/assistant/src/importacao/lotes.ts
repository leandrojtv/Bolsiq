import { estimarTokens, LIMITE_DE_TOKENS } from "../orcamento.js";
import { SISTEMA_DE_IMPORTACAO, blocoDoDocumento } from "../../prompts/importacao-v1.js";
import type { Parte } from "./texto.js";

/** Saida maxima quando o catalogo do provedor nao informa. */
export const MAX_TOKENS_DE_SAIDA_NA_IMPORTACAO = 8_000;
/** Contexto quando o catalogo do provedor nao informa. */
export const CONTEXTO_PADRAO = 32_000;

/** O que o modelo aguenta por chamada, lido do catalogo (modelos.json ou API do provedor). */
export interface LimitesDoModelo {
  contexto: number;
  max_saida: number;
}

/**
 * Entrada de cada lote pelo orcamento do modelo: a saida em CSV tem cerca de 4
 * tokens por token lido (cada linha leva as 27 colunas, a origem e o trecho; a
 * posicao da XP deu 8,9 mil de saida para 2,4 mil de texto, #43), entao o lote
 * fica em 25% da saida maxima; e entrada, prompt e saida cabem no contexto e
 * abaixo de LIMITE_DE_TOKENS (100 mil por chamada).
 */
export function tokensPorLote(
  maxSaida = MAX_TOKENS_DE_SAIDA_NA_IMPORTACAO,
  contexto = CONTEXTO_PADRAO,
): number {
  const prompt = estimarTokens(SISTEMA_DE_IMPORTACAO);
  const cabe = Math.min(contexto, LIMITE_DE_TOKENS) - maxSaida - prompt - 1_000;
  return Math.max(1_000, Math.min(Math.floor(maxSaida * 0.25), cabe, 20_000));
}
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

/**
 * Metade das paginas ou abas para cada lado; lote de uma pagina so divide as
 * linhas dela, repetindo o cabecalho da tabela. Nulo quando nao ha o que dividir.
 */
export function dividirLoteAoMeio(l: Lote): [Lote, Lote] | null {
  if (l.partes.length > 1) {
    const meio = Math.ceil(l.partes.length / 2);
    return [{ partes: l.partes.slice(0, meio) }, { partes: l.partes.slice(meio) }];
  }
  const [unica] = l.partes;
  if (!unica) return null;
  const pedacos = dividirParte(unica, Math.ceil(estimarTokens(unica.texto) / 2) + 1);
  if (pedacos.length < 2) return null;
  const meio = Math.ceil(pedacos.length / 2);
  const juntar = (ps: Parte[]): Parte => ({
    origem: unica.origem,
    texto: ps
      .map((x, i) =>
        i === 0 ? x.texto : x.texto.split("\n").slice(cabecalhoDe(x.texto)).join("\n"),
      )
      .join("\n"),
  });
  return [
    { partes: [juntar(pedacos.slice(0, meio))] },
    { partes: [juntar(pedacos.slice(meio))] },
  ];
}

const cabecalhoDe = (texto: string) => (texto.startsWith("[separador") ? 2 : 0);
