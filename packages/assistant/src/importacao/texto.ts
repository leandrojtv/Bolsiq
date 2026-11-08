import { detectarSeparador } from "@bolsiq/portfolio";
import * as XLSX from "xlsx";
import {
  ErroDeImportacao,
  LIMITE_DE_PAGINAS,
  type TipoDeArquivo,
} from "./recebimento.js";

/** Um pedaco do documento com origem: "página 3", "aba Ações" ou "texto". */
export interface Parte {
  origem: string;
  texto: string;
}

export interface TextoDoDocumento {
  partes: Parte[];
  paginas: number;
  /** Paginas de PDF sem texto (escaneadas) e imagem: so com modelo de visao. */
  sem_texto: string[];
  /** O arquivo vai ao modelo como imagem ou PDF. Nao passa pela anonimizacao. */
  arquivo_para_visao: { mime: string; dados: Uint8Array } | null;
}

/** Bancos ainda exportam CSV em Windows-1252: UTF-8 invalido cai para ele. */
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
  return {
    partes: [
      {
        origem,
        texto: pareceTabela ? `[separador ${separador}]\n${conteudo}` : conteudo,
      },
    ],
    paginas: 1,
    sem_texto: [],
    arquivo_para_visao: null,
  };
}

/**
 * Cada aba vira uma tabela em texto. Numero sai cru (`1234.5`), sem a mascara da
 * celula: "R$ 1.234,50" formatado esconderia casas e o separador.
 */
function planilha(bytes: Uint8Array): TextoDoDocumento {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true, dense: true });
  const partes = wb.SheetNames.flatMap((nome) => {
    const aba = wb.Sheets[nome];
    if (!aba) return [];
    const texto = XLSX.utils
      .sheet_to_csv(aba, {
        FS: ";",
        blankrows: false,
        rawNumbers: true,
        dateNF: "yyyy-mm-dd",
      })
      .split("\n")
      .filter((l) => l.replace(/;/g, "").trim() !== "")
      .join("\n");
    return texto ? [{ origem: `aba ${nome}`, texto: `[separador ;]\n${texto}` }] : [];
  });
  if (wb.SheetNames.length > LIMITE_DE_PAGINAS)
    throw new ErroDeImportacao(
      "paginas_demais",
      `Planilha com ${wb.SheetNames.length} abas: o limite é ${LIMITE_DE_PAGINAS}.`,
    );
  return {
    partes,
    paginas: wb.SheetNames.length,
    sem_texto: [],
    arquivo_para_visao: null,
  };
}

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

async function pdf(bytes: Uint8Array): Promise<TextoDoDocumento> {
  // O worker roda na mesma thread: importar o modulo registra `globalThis.pdfjsWorker`.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const tarefa = getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    const doc = await tarefa.promise;
    if (doc.numPages > LIMITE_DE_PAGINAS)
      throw new ErroDeImportacao(
        "paginas_demais",
        `PDF com ${doc.numPages} páginas: o limite é ${LIMITE_DE_PAGINAS}.`,
      );
    const partes: Parte[] = [];
    const sem_texto: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const pagina = await doc.getPage(n);
      const conteudo = await pagina.getTextContent();
      const texto = linhasDaPagina(
        conteudo.items.flatMap((i) => ("str" in i ? [i] : [])),
      );
      // Menos que isto e cabecalho de scanner, nao o extrato.
      if (texto.replace(/\s/g, "").length < 20) sem_texto.push(`página ${n}`);
      else partes.push({ origem: `página ${n}`, texto });
    }
    return {
      partes,
      paginas: doc.numPages,
      sem_texto,
      arquivo_para_visao:
        sem_texto.length > 0 ? { mime: "application/pdf", dados: bytes } : null,
    };
  } finally {
    await tarefa.destroy();
  }
}

const MIME_DA_IMAGEM = (b: Uint8Array) =>
  b[0] === 0x89 ? "image/png" : b[0] === 0xff ? "image/jpeg" : "image/webp";

/** Texto sem IA, por tipo. Imagem e PDF escaneado so marcam o que precisa de visao. */
export async function extrairTexto(
  bytes: Uint8Array,
  tipo: TipoDeArquivo,
): Promise<TextoDoDocumento> {
  switch (tipo) {
    case "csv":
    case "txt":
      return textoSimples(decodificar(bytes), "texto");
    case "xlsx":
    case "xls":
      return planilha(bytes);
    case "pdf":
      return pdf(bytes);
    case "imagem":
      return {
        partes: [],
        paginas: 1,
        sem_texto: ["imagem"],
        arquivo_para_visao: { mime: MIME_DA_IMAGEM(bytes), dados: bytes },
      };
  }
}

export const textoColado = (texto: string): TextoDoDocumento =>
  textoSimples(texto, "texto");
