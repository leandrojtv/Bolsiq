import { custoEstimado, estimarTokens } from "../orcamento.js";
import { anonimizar, semRemocoes, somarRemocoes, type Remocoes } from "./anonimizar.js";
import {
  MAX_TOKENS_DE_SAIDA_NA_IMPORTACAO,
  montarLotes,
  TOKENS_POR_PAGINA_DE_IMAGEM,
  tokensDaChamada,
  tokensPorLote,
  type Lote,
} from "./lotes.js";
import {
  conferirTamanho,
  ErroDeImportacao,
  hashDoConteudo,
  LIMITE_DE_TEXTO,
  tipoDoArquivo,
  type TipoDeArquivo,
} from "./recebimento.js";
import {
  decodificar,
  extrairTexto,
  textoColado,
  type Parte,
  type TextoDoDocumento,
} from "./texto.js";

/** Acima disto, a IA custaria caro e demoraria: melhor dividir o arquivo. */
export const MAX_TOKENS_POR_DOCUMENTO = 300_000;

/** Layouts que o importador atual ja le sem IA. */
export type Atalho = "bolsiq" | "b3" | "posicao_bolsiq";

export type Entrada =
  { nome: string; mime: string; bytes: Uint8Array } | { texto: string };

export interface ArquivoPreparado {
  nome: string;
  tipo: TipoDeArquivo | "texto";
  hash: string;
  /** Reconhecido pelo cabecalho: vai para o importador atual, sem chamar a IA. */
  atalho: Atalho | null;
  /** Ja anonimizadas: e isto, e so isto, que vai ao provedor como texto. */
  partes: Parte[];
  sem_texto: string[];
  arquivo_para_visao: { mime: string; dados: Uint8Array } | null;
  paginas: number;
  remocoes: Remocoes;
  lotes: Lote[];
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** O mesmo reconhecimento por cabecalho da tela de importacao. */
export function detectarAtalho(conteudo: string): Atalho | null {
  const cabecalho = semAcento(conteudo.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "");
  const colunas = cabecalho.split(/[;,]/).map((c) => c.trim().replace(/^"|"$/g, ""));
  if (colunas.includes("data_posicao") && colunas.includes("classe"))
    return "posicao_bolsiq";
  if (["data", "ticker", "tipo", "quantidade", "preco"].every((c) => colunas.includes(c)))
    return "bolsiq";
  const tem = (n: string) => colunas.some((c) => c.includes(n));
  if (tem("movimentacao") && tem("codigo") && tem("quantidade") && tem("preco"))
    return "b3";
  if (tem("data do negocio") && tem("codigo de negociacao")) return "b3";
  return null;
}

/**
 * Recebimento, atalho, extracao de texto e anonimizacao. Sem IA e sem rede: o que
 * sai daqui e o que pode ir ao provedor.
 */
export async function prepararArquivo(
  e: Entrada,
  maxSaida = MAX_TOKENS_DE_SAIDA_NA_IMPORTACAO,
): Promise<ArquivoPreparado> {
  let nome: string;
  let tipo: TipoDeArquivo | "texto";
  let hash: string;
  let atalho: Atalho | null = null;
  let texto: TextoDoDocumento | null;
  if ("texto" in e) {
    if (!e.texto.trim()) throw new ErroDeImportacao("vazio", "Cole o texto do extrato.");
    if (e.texto.length > LIMITE_DE_TEXTO)
      throw new ErroDeImportacao("grande_demais", "Texto acima de 10 MB.", 413);
    nome = "texto colado";
    tipo = "texto";
    hash = hashDoConteudo(new TextEncoder().encode(e.texto));
    atalho = detectarAtalho(e.texto);
    texto = textoColado(e.texto);
  } else {
    conferirTamanho(e.bytes.byteLength);
    nome = e.nome;
    tipo = tipoDoArquivo(e.nome, e.mime, e.bytes);
    hash = hashDoConteudo(e.bytes);
    if (tipo === "csv" || tipo === "txt") atalho = detectarAtalho(decodificar(e.bytes));
    texto = atalho ? null : await extrairTexto(e.bytes, tipo);
  }

  if (atalho || !texto)
    return {
      nome,
      tipo,
      hash,
      atalho,
      partes: [],
      sem_texto: [],
      arquivo_para_visao: null,
      paginas: 0,
      remocoes: semRemocoes(),
      lotes: [],
    };

  let remocoes = semRemocoes();
  const partes = texto.partes.map((p) => {
    const a = anonimizar(p.texto);
    remocoes = somarRemocoes(remocoes, a.remocoes);
    return { origem: p.origem, texto: a.texto };
  });
  const lotes = montarLotes(partes, tokensPorLote(maxSaida));
  const total = lotes.reduce((s, l) => s + estimarTokens(JSON.stringify(l)), 0);
  if (total > MAX_TOKENS_POR_DOCUMENTO)
    throw new ErroDeImportacao(
      "documento_grande",
      "Documento grande demais para a IA. Divida o arquivo por período ou por conta.",
      413,
    );
  if (partes.length === 0 && !texto.arquivo_para_visao)
    throw new ErroDeImportacao("sem_conteudo", `Nada a importar em ${nome}.`);
  return {
    nome,
    tipo,
    hash,
    atalho: null,
    partes,
    sem_texto: texto.sem_texto,
    arquivo_para_visao: texto.arquivo_para_visao,
    paginas: texto.paginas,
    remocoes,
    lotes,
  };
}

export interface Capacidades {
  saida_estruturada: boolean;
  visao: boolean;
  max_saida: number;
}

/** PDF escaneado e imagem so com modelo de visao; sem saida estruturada, nada. */
export function conferirCapacidades(p: ArquivoPreparado, c: Capacidades): void {
  if (!c.saida_estruturada)
    throw new ErroDeImportacao(
      "modelo_sem_saida_estruturada",
      "O modelo escolhido não tem saída estruturada. Escolha outro em Configurações do assistente.",
      409,
    );
  if (p.arquivo_para_visao && !c.visao)
    throw new ErroDeImportacao(
      "modelo_sem_visao",
      p.tipo === "imagem"
        ? "Imagem só com um modelo que lê imagens (visão). Escolha outro modelo ou envie o PDF com texto."
        : `${p.nome} tem páginas sem texto (${p.sem_texto.join(", ")}): parece escaneado. Só um modelo com visão lê essas páginas.`,
      409,
    );
}

export interface Estimativa {
  chamadas: number;
  tokens_entrada: number;
  tokens_saida: number;
  /** Dolares; nulo sem preco conhecido. */
  custo_estimado: string | null;
}

/**
 * Estimativa antes de gastar: entrada pelo tamanho do texto (mais a pagina de
 * imagem), saida pela proporcao tipica da extracao, de 1,2 token por token lido,
 * limitada ao teto por chamada.
 */
export function estimarImportacao(
  p: ArquivoPreparado,
  preco: { entrada: number | null; saida: number | null },
  maxSaida = MAX_TOKENS_DE_SAIDA_NA_IMPORTACAO,
): Estimativa {
  const porLote = p.lotes.map(tokensDaChamada);
  const visao = p.arquivo_para_visao
    ? p.sem_texto.length * TOKENS_POR_PAGINA_DE_IMAGEM
    : 0;
  const tokens_entrada = porLote.reduce((s, t) => s + t, 0) + (visao ? visao + 3_000 : 0);
  const tokens_saida =
    porLote.reduce((s, t) => s + Math.min(maxSaida, Math.ceil(t * 1.2)), 0) +
    (visao ? Math.min(maxSaida, visao * 2) : 0);
  return {
    chamadas: p.lotes.length + (p.arquivo_para_visao ? 1 : 0),
    tokens_entrada,
    tokens_saida,
    custo_estimado: custoEstimado({ tokens_entrada, tokens_saida }, preco),
  };
}
