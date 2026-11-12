import { custoEstimado } from "../orcamento.js";
import { anonimizar, semRemocoes, somarRemocoes, type Remocoes } from "./anonimizar.js";
import {
  MAX_TOKENS_DE_SAIDA_NA_IMPORTACAO,
  montarLotes,
  TOKENS_POR_PAGINA_DE_IMAGEM,
  tokensDaChamada,
  tokensPorLote,
  type LimitesDoModelo,
  type Lote,
} from "./lotes.js";
import {
  conferirTamanho,
  ErroDeImportacao,
  hashDoConteudo,
  LIMITES_PADRAO,
  tipoDoArquivo,
  type Limites,
  type TipoDeArquivo,
} from "./recebimento.js";
import {
  decodificar,
  extrairTexto,
  textoColado,
  type Estrategia,
  type Imagem,
  type Parte,
  type TabelaNoLayout,
  type TextoDoDocumento,
} from "./texto.js";

import { detectarAtalho, type Atalho } from "./atalho.js";
import type { FerramentasDoSistema } from "./ferramentas.js";
export { detectarAtalho, type Atalho } from "./atalho.js";

export type Entrada =
  { nome: string; mime: string; bytes: Uint8Array } | { texto: string };

export interface ArquivoPreparado {
  nome: string;
  tipo: TipoDeArquivo | "texto";
  hash: string;
  /** O arquivo inteiro no layout do Bolsiq: vai para o importador atual, sem IA. */
  atalho: Atalho | null;
  /** Ja anonimizadas: e isto, e so isto, que vai ao provedor como texto. */
  partes: Parte[];
  sem_texto: string[];
  /** Paginas escaneadas e fotos, para modelo com visao. Sem anonimizacao. */
  imagens: Imagem[];
  arquivo_para_visao: { mime: string; dados: Uint8Array } | null;
  /** Abas no layout do Bolsiq: lidas sem IA, entram na mesma revisao. */
  no_layout: TabelaNoLayout[];
  /** Paginas lidas por OCR local. */
  ocr: string[];
  estrategia: Estrategia;
  paginas: number;
  remocoes: Remocoes;
  lotes: Lote[];
}

export interface OpcoesDePreparo {
  limites: LimitesDoModelo;
  /** O modelo le imagem: pagina escaneada vai como imagem; sem isso, OCR. */
  visao: boolean;
  ferramentas: FerramentasDoSistema;
  limites_do_envio?: Limites;
}

/**
 * Recebimento, atalho, extracao de texto e anonimizacao. Sem IA e sem rede: o que
 * sai daqui e o que pode ir ao provedor. Nada bloqueia por tamanho de documento:
 * o custo vira estimativa, mostrada antes de comecar.
 */
export async function prepararArquivo(
  e: Entrada,
  o: OpcoesDePreparo,
): Promise<ArquivoPreparado> {
  const envio = o.limites_do_envio ?? LIMITES_PADRAO;
  let nome: string;
  let tipo: TipoDeArquivo | "texto";
  let hash: string;
  let atalho: Atalho | null = null;
  let texto: TextoDoDocumento | null;
  if ("texto" in e) {
    if (!e.texto.trim()) throw new ErroDeImportacao("vazio", "Cole o texto do extrato.");
    conferirTamanho(e.texto.length, envio.bytes);
    nome = "texto colado";
    tipo = "texto";
    hash = hashDoConteudo(new TextEncoder().encode(e.texto));
    atalho = detectarAtalho(e.texto);
    texto = textoColado(e.texto);
  } else {
    conferirTamanho(e.bytes.byteLength, envio.bytes);
    nome = e.nome;
    tipo = tipoDoArquivo(e.nome, e.mime, e.bytes);
    hash = hashDoConteudo(e.bytes);
    if (tipo === "csv" || tipo === "txt") atalho = detectarAtalho(decodificar(e.bytes));
    texto = atalho
      ? null
      : await extrairTexto(e.bytes, tipo, {
          visao: o.visao,
          ferramentas: o.ferramentas,
          limite_de_paginas: envio.paginas,
        });
  }

  const vazio = {
    partes: [],
    sem_texto: [],
    imagens: [],
    arquivo_para_visao: null,
    no_layout: [],
    ocr: [],
    estrategia: "texto" as const,
    paginas: 0,
    remocoes: semRemocoes(),
    lotes: [],
  };
  if (atalho || !texto) return { nome, tipo, hash, atalho, ...vazio };

  let remocoes = semRemocoes();
  const partes = texto.partes.map((p) => {
    const a = anonimizar(p.texto);
    remocoes = somarRemocoes(remocoes, a.remocoes);
    return { origem: p.origem, texto: a.texto };
  });
  if (
    partes.length === 0 &&
    texto.imagens.length === 0 &&
    !texto.arquivo_para_visao &&
    texto.no_layout.length === 0
  )
    throw new ErroDeImportacao("sem_conteudo", `Não há dados para importar em ${nome}.`);
  return {
    nome,
    tipo,
    hash,
    atalho: null,
    partes,
    sem_texto: texto.sem_texto,
    imagens: texto.imagens,
    arquivo_para_visao: texto.arquivo_para_visao,
    no_layout: texto.no_layout,
    ocr: texto.ocr,
    estrategia: texto.estrategia,
    paginas: texto.paginas,
    remocoes,
    lotes: montarLotes(partes, tokensPorLote(o.limites.max_saida, o.limites.contexto)),
  };
}

export interface Capacidades {
  /** Preferencia: o cabecalho vai por schema; sem ela, por JSON em texto. */
  saida_estruturada: boolean;
  /** Preferencia: pagina escaneada vai como imagem; sem ela, por OCR. */
  visao: boolean;
  max_saida: number;
  contexto: number;
}

/** Imagens por chamada de visao. */
export const IMAGENS_POR_CHAMADA = 4;

export interface Estimativa {
  chamadas: number;
  tokens_entrada: number;
  tokens_saida: number;
  /** Dolares; nulo sem preco conhecido. */
  custo_estimado: string | null;
}

/**
 * Estimativa antes de gastar: entrada pelo tamanho do texto (mais as paginas de
 * imagem), saida pela proporcao tipica da extracao em CSV, de 1,2 token por token
 * lido, limitada ao teto por chamada. Mais uma rodada de autocorrecao pequena.
 */
export function estimarImportacao(
  p: ArquivoPreparado,
  preco: { entrada: number | null; saida: number | null },
  maxSaida = MAX_TOKENS_DE_SAIDA_NA_IMPORTACAO,
): Estimativa {
  const porLote = p.lotes.map(tokensDaChamada);
  const paginasDeImagem =
    p.imagens.length + (p.arquivo_para_visao ? p.sem_texto.length : 0);
  const visao = paginasDeImagem * TOKENS_POR_PAGINA_DE_IMAGEM;
  const chamadasDeVisao =
    Math.ceil(p.imagens.length / IMAGENS_POR_CHAMADA) + (p.arquivo_para_visao ? 1 : 0);
  // O cabecalho: prompt curto, as primeiras e as ultimas paginas, e um JSON pequeno.
  const cabecalho = { entrada: 1_000 + Math.min(6_000, ...porLote) + visao, saida: 500 };
  const lotes = porLote.reduce((s, t) => s + t, 0);
  const saidaDosLotes = porLote.reduce(
    (s, t) => s + Math.min(maxSaida, Math.ceil(t * 1.2)),
    0,
  );
  const correcao = {
    entrada: Math.ceil(lotes * 0.1),
    saida: Math.ceil(saidaDosLotes * 0.1),
  };
  const tokens_entrada =
    cabecalho.entrada +
    lotes +
    (visao ? visao + 3_000 * chamadasDeVisao : 0) +
    correcao.entrada;
  const tokens_saida =
    cabecalho.saida +
    saidaDosLotes +
    (visao ? Math.min(maxSaida * chamadasDeVisao, visao * 2) : 0) +
    correcao.saida;
  return {
    chamadas: 1 + p.lotes.length + chamadasDeVisao,
    tokens_entrada,
    tokens_saida,
    custo_estimado: custoEstimado({ tokens_entrada, tokens_saida }, preco),
  };
}
