import { detectarSeparador } from "@bolsiq/portfolio";
import * as XLSX from "xlsx";
import { detectarAtalho, type Atalho } from "./atalho.js";
import type { FerramentasDoSistema } from "./ferramentas.js";
import { ErroDeImportacao, type TipoDeArquivo } from "./recebimento.js";

/** Um pedaco do documento com origem: "página 3", "aba Ações" ou "texto". */
export interface Parte {
  origem: string;
  texto: string;
}

/** Pagina escaneada ou foto, para modelo com visao. Nao passa pela anonimizacao. */
export interface Imagem {
  origem: string;
  mime: string;
  dados: Uint8Array;
}

/** Aba (ou arquivo) ja no layout do Bolsiq: vai pelo importador de sempre, sem IA. */
export interface TabelaNoLayout {
  origem: string;
  atalho: Atalho;
  conteudo: string;
}

/** Como o arquivo vai ao modelo: so texto, pagina como imagem ou OCR local. */
export type Estrategia = "texto" | "visao" | "ocr";

export interface TextoDoDocumento {
  partes: Parte[];
  paginas: number;
  /** Origens sem texto extraido: vao como imagem (visao). */
  sem_texto: string[];
  imagens: Imagem[];
  /** Sem renderizador, o PDF inteiro vai ao modelo de visao. */
  arquivo_para_visao: { mime: string; dados: Uint8Array } | null;
  no_layout: TabelaNoLayout[];
  /** Origens lidas por OCR: o texto delas tambem e conferivel. */
  ocr: string[];
  estrategia: Estrategia;
}

export interface OpcoesDeLeitura {
  /** O modelo escolhido le imagem. Sem visao, pagina escaneada vai por OCR. */
  visao: boolean;
  ferramentas: FerramentasDoSistema;
  limite_de_paginas: number;
}

const vazio = (o: Partial<TextoDoDocumento> = {}): TextoDoDocumento => ({
  partes: [],
  paginas: 1,
  sem_texto: [],
  imagens: [],
  arquivo_para_visao: null,
  no_layout: [],
  ocr: [],
  estrategia: "texto",
  ...o,
});

// ---------------------------------------------------------------------------
// CSV e TXT
// ---------------------------------------------------------------------------

/**
 * UTF-8 primeiro; invalido, Windows-1252 (superconjunto do latin1 nos
 * caracteres imprimiveis), que e o que banco antigo e Excel brasileiro exportam.
 */
export function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function textoSimples(conteudo: string, origem: string): TextoDoDocumento {
  const primeira = conteudo.split(/\r?\n/, 1)[0] ?? "";
  const separador = detectarSeparador(primeira);
  const pareceTabela = primeira.includes(separador);
  return vazio({
    partes: [
      {
        origem,
        texto: pareceTabela ? `[separador ${separador}]\n${conteudo}` : conteudo,
      },
    ],
  });
}

export const textoColado = (texto: string): TextoDoDocumento =>
  textoSimples(texto, "texto");

// ---------------------------------------------------------------------------
// Planilha
// ---------------------------------------------------------------------------

type Celula = string | number | boolean | Date | null | undefined;

const comoTexto = (c: Celula): string => {
  if (c === null || c === undefined) return "";
  if (c instanceof Date)
    return Number.isNaN(c.getTime()) ? "" : c.toISOString().slice(0, 10);
  return String(c).replace(/\s+/g, " ").trim();
};

/** Celula mesclada: o valor do canto vale para o intervalo inteiro. */
function expandirMesclas(aba: XLSX.WorkSheet, linhas: Celula[][]): void {
  for (const m of aba["!merges"] ?? []) {
    const valor = linhas[m.s.r]?.[m.s.c];
    for (let r = m.s.r; r <= m.e.r; r++)
      for (let c = m.s.c; c <= m.e.c; c++) {
        const linha = (linhas[r] ??= []);
        if (linha[c] === undefined || linha[c] === "") linha[c] = valor;
      }
  }
}

const preenchidas = (l: string[]) => l.filter((c) => c !== "").length;
const ehNumero = (c: string) => /^[-+(]?(R\$\s*)?[\d.,]+%?\)?$/.test(c);

/**
 * A primeira linha "parecida com cabecalho": duas ou mais celulas, a maioria
 * texto (nao numero), seguida de uma linha com dados. Extrato de banco poe
 * titulo, titular e data antes da tabela; o cabecalho nem sempre e a linha 1.
 */
export function linhaDoCabecalho(linhas: string[][]): number {
  for (let i = 0; i < linhas.length; i++) {
    const cheias = (linhas[i] ?? []).filter((c) => c !== "");
    if (cheias.length < 2) continue;
    const textos = cheias.filter((c) => !ehNumero(c)).length;
    if (textos / cheias.length >= 0.6 && preenchidas(linhas[i + 1] ?? []) >= 2) return i;
  }
  return 0;
}

const campoCsv = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * Cada aba vira uma tabela: mesclas expandidas, linhas e colunas vazias fora,
 * cabecalho detectado. O que vem antes do cabecalho (titulo, data, total) fica
 * como texto acima da tabela, porque costuma ter a data e os totais.
 */
export function tabelasDaPlanilha(
  bytes: Uint8Array,
): { origem: string; csv: string; preambulo: string }[] {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  return wb.SheetNames.flatMap((nome) => {
    const aba = wb.Sheets[nome];
    if (!aba) return [];
    const brutas = XLSX.utils.sheet_to_json<Celula[]>(aba, {
      header: 1,
      raw: true,
      defval: "",
    });
    expandirMesclas(aba, brutas);
    const linhas = brutas.map((l) => l.map(comoTexto)).filter((l) => preenchidas(l) > 0);
    if (linhas.length === 0) return [];
    const largura = Math.max(...linhas.map((l) => l.length));
    const cheias = Array.from({ length: largura }, (_, c) =>
      linhas.some((l) => (l[c] ?? "") !== ""),
    );
    const limpas = linhas.map((l) =>
      Array.from({ length: largura }, (_, c) => l[c] ?? "").filter((_, c) => cheias[c]),
    );
    const i = linhaDoCabecalho(limpas);
    const preambulo = limpas
      .slice(0, i)
      .map((l) => l.filter(Boolean).join(" "))
      .join("\n");
    const csv = limpas
      .slice(i)
      .map((l) => l.map(campoCsv).join(";"))
      .join("\n");
    return [{ origem: `aba ${nome}`, csv, preambulo }];
  });
}

function planilha(bytes: Uint8Array, limite: number): TextoDoDocumento {
  const tabelas = tabelasDaPlanilha(bytes);
  if (tabelas.length > limite)
    throw new ErroDeImportacao(
      "paginas_demais",
      `A planilha tem ${tabelas.length} abas; o limite é ${limite}. Envie as abas em arquivos separados.`,
    );
  const r = vazio({ paginas: tabelas.length });
  for (const t of tabelas) {
    const atalho = detectarAtalho(t.csv);
    if (atalho) r.no_layout.push({ origem: t.origem, atalho, conteudo: t.csv });
    else
      r.partes.push({
        origem: t.origem,
        texto: [t.preambulo, "[separador ;]", t.csv].filter(Boolean).join("\n"),
      });
  }
  return r;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

interface ItemDeTexto {
  str: string;
  transform: number[];
  width: number;
}

/** Junta os itens do pdf.js em linhas pela altura, e separa colunas pelo espaco. */
function linhasDaPagina(itens: ItemDeTexto[]): string {
  const linhas = new Map<number, ItemDeTexto[]>();
  for (const it of itens) {
    if (!it.str.trim()) continue;
    const y = Math.round((it.transform[5] ?? 0) / 2) * 2;
    linhas.set(y, [...(linhas.get(y) ?? []), it]);
  }
  return [...linhas.entries()]
    .sort(([a], [b]) => b - a)
    .map(([, l]) => {
      const ordenados = l.sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0));
      let texto = "";
      let fim = -Infinity;
      for (const it of ordenados) {
        const x = it.transform[4] ?? 0;
        texto += texto === "" ? it.str : x - fim > 12 ? ` | ${it.str}` : ` ${it.str}`;
        fim = x + it.width;
      }
      return texto.replace(/\s+/g, " ").trim();
    })
    .join("\n");
}

/** Menos que isto e cabecalho de scanner, nao o extrato. */
const temTexto = (t: string) => t.replace(/\s/g, "").length >= 20;

async function pdfjs() {
  // O worker roda na mesma thread: importar o modulo registra `globalThis.pdfjsWorker`.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

/** O PDF pede senha? (o pdf.js recusa com PasswordException). */
export async function exigeSenha(bytes: Uint8Array): Promise<boolean> {
  const { getDocument } = await pdfjs();
  const tarefa = getDocument({ data: bytes.slice(), verbosity: 0 });
  try {
    await tarefa.promise;
    return false;
  } catch (e) {
    return (e as { name?: string }).name === "PasswordException";
  } finally {
    await tarefa.destroy();
  }
}

/** Texto por pagina pelo pdf.js; o que ele nao abre, pelo pdftotext. */
async function textoDasPaginas(
  bytes: Uint8Array,
  f: FerramentasDoSistema,
): Promise<string[]> {
  const { getDocument } = await pdfjs();
  const tarefa = getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    const doc = await tarefa.promise;
    const paginas: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const conteudo = await (await doc.getPage(n)).getTextContent();
      paginas.push(
        linhasDaPagina(conteudo.items.flatMap((i) => ("str" in i ? [i] : []))),
      );
    }
    return paginas;
  } catch (e) {
    if ((e as { name?: string }).name === "PasswordException")
      throw new ErroDeImportacao(
        "precisa_senha",
        "Este PDF tem senha. Informe a senha para abrir (muitos bancos usam parte do CPF).",
        422,
      );
    if (!f.pdftotext)
      throw new ErroDeImportacao(
        "pdf_ilegivel",
        "Não foi possível ler este PDF. Tente exportá-lo de novo pelo site do banco.",
      );
    return f.pdftotext(bytes);
  } finally {
    await tarefa.destroy();
  }
}

const numeroDaPagina = (origem: string) => Number(/\d+/.exec(origem)?.[0] ?? 0);

async function pdf(bytes: Uint8Array, o: OpcoesDeLeitura): Promise<TextoDoDocumento> {
  const paginas = await textoDasPaginas(bytes, o.ferramentas);
  if (paginas.length > o.limite_de_paginas)
    throw new ErroDeImportacao(
      "paginas_demais",
      `O PDF tem ${paginas.length} páginas; o limite é ${o.limite_de_paginas}. Divida o arquivo por período.`,
    );
  const r = vazio({ paginas: paginas.length });
  const escaneadas: number[] = [];
  paginas.forEach((t, i) => {
    if (temTexto(t)) r.partes.push({ origem: `página ${i + 1}`, texto: t });
    else escaneadas.push(i + 1);
  });
  if (escaneadas.length === 0) return r;

  const f = o.ferramentas;
  for (const n of escaneadas) {
    const origem = `página ${n}`;
    if (o.visao && f.renderizar) {
      r.imagens.push({ origem, mime: "image/png", dados: await f.renderizar(bytes, n) });
      r.sem_texto.push(origem);
    } else if (f.ocr && f.renderizar) {
      r.partes.push({ origem, texto: await f.ocr(await f.renderizar(bytes, n)) });
      r.ocr.push(origem);
    } else if (o.visao) {
      r.sem_texto.push(origem);
      r.arquivo_para_visao = { mime: "application/pdf", dados: bytes };
    } else
      throw new ErroDeImportacao(
        "sem_ocr",
        "O PDF tem páginas escaneadas e este servidor não tem OCR. Peça ao administrador para instalar o tesseract.",
        503,
      );
  }
  r.partes.sort((a, b) => numeroDaPagina(a.origem) - numeroDaPagina(b.origem));
  r.estrategia = r.ocr.length > 0 ? "ocr" : "visao";
  return r;
}

// ---------------------------------------------------------------------------
// Imagem
// ---------------------------------------------------------------------------

const MIME_DA_IMAGEM = (b: Uint8Array) =>
  b[0] === 0x89 ? "image/png" : b[0] === 0xff ? "image/jpeg" : "image/webp";

/** HEIC/HEIF do celular: caixa ftyp com marca heic, heix, mif1 ou msf1. */
export const ehHeic = (b: Uint8Array) => {
  const t = new TextDecoder("latin1").decode(b.slice(4, 12));
  return t.startsWith("ftyp") && /heic|heix|mif1|msf1|hevc/.test(t.slice(4));
};

async function imagem(bytes: Uint8Array, o: OpcoesDeLeitura): Promise<TextoDoDocumento> {
  let dados = bytes;
  if (ehHeic(bytes)) {
    if (!o.ferramentas.heicParaPng)
      throw new ErroDeImportacao(
        "heic",
        "Não foi possível converter a foto HEIC neste servidor. Envie em JPG ou PNG.",
        503,
      );
    dados = await o.ferramentas.heicParaPng(bytes);
  }
  if (o.visao)
    return vazio({
      sem_texto: ["imagem"],
      imagens: [{ origem: "imagem", mime: MIME_DA_IMAGEM(dados), dados }],
      estrategia: "visao",
    });
  if (!o.ferramentas.ocr)
    throw new ErroDeImportacao(
      "sem_ocr",
      "Para ler imagem com um modelo que não vê imagens, o servidor precisa do OCR (tesseract).",
      503,
    );
  return vazio({
    partes: [{ origem: "imagem", texto: await o.ferramentas.ocr(dados) }],
    ocr: ["imagem"],
    estrategia: "ocr",
  });
}

/** Texto sem IA, por tipo. Pagina escaneada e imagem: visao, se houver; senao OCR. */
export async function extrairTexto(
  bytes: Uint8Array,
  tipo: TipoDeArquivo,
  o: OpcoesDeLeitura,
): Promise<TextoDoDocumento> {
  switch (tipo) {
    case "csv":
    case "txt":
      return textoSimples(decodificar(bytes), "texto");
    case "xlsx":
    case "xls":
    case "ods":
      return planilha(bytes, o.limite_de_paginas);
    case "pdf":
      return pdf(bytes, o);
    case "imagem":
      return imagem(bytes, o);
  }
}
