import { createHash } from "node:crypto";
import type { Uso } from "../orcamento.js";

/** 10 MB: uma posicao detalhada da XP em PDF tem algumas centenas de KB. */
export const LIMITE_DE_BYTES = 10 * 1024 * 1024;
export const LIMITE_DE_PAGINAS = 30;
/** Texto colado: o mesmo teto do arquivo, em caracteres. */
export const LIMITE_DE_TEXTO = LIMITE_DE_BYTES;

export type TipoDeArquivo = "csv" | "txt" | "xlsx" | "xls" | "pdf" | "imagem";

export class ErroDeImportacao extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
    readonly status = 422,
    /** Tokens ja gastos antes da falha: entram no consumo do mesmo jeito. */
    readonly uso: Uso | null = null,
  ) {
    super(mensagem);
  }
}

/** Extensao e os MIME que o navegador manda para ela. `""` e octet-stream valem para todas. */
const TIPOS: Record<string, { tipo: TipoDeArquivo; mimes: string[] }> = {
  csv: {
    tipo: "csv",
    mimes: ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"],
  },
  txt: { tipo: "txt", mimes: ["text/plain"] },
  xlsx: {
    tipo: "xlsx",
    mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  },
  xls: { tipo: "xls", mimes: ["application/vnd.ms-excel"] },
  pdf: { tipo: "pdf", mimes: ["application/pdf"] },
  png: { tipo: "imagem", mimes: ["image/png"] },
  jpg: { tipo: "imagem", mimes: ["image/jpeg"] },
  jpeg: { tipo: "imagem", mimes: ["image/jpeg"] },
  webp: { tipo: "imagem", mimes: ["image/webp"] },
};

const GENERICOS = ["", "application/octet-stream"];

export const EXTENSOES_ACEITAS = Object.keys(TIPOS).map((e) => `.${e}`);

/** Assinatura dos binarios: extensao trocada nao passa por PDF nem por planilha. */
function assinaturaConfere(tipo: TipoDeArquivo, b: Uint8Array): boolean {
  const comeca = (...bytes: number[]) => bytes.every((x, i) => b[i] === x);
  switch (tipo) {
    case "pdf":
      return comeca(0x25, 0x50, 0x44, 0x46);
    case "xlsx":
      return comeca(0x50, 0x4b);
    case "xls":
      return comeca(0xd0, 0xcf, 0x11, 0xe0);
    case "imagem":
      return (
        comeca(0x89, 0x50, 0x4e, 0x47) ||
        comeca(0xff, 0xd8, 0xff) ||
        (comeca(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45)
      );
    default:
      return true;
  }
}

/** Tipo pelo nome e pelo MIME, conferido pela assinatura do conteudo. */
export function tipoDoArquivo(
  nome: string,
  mime: string,
  bytes: Uint8Array,
): TipoDeArquivo {
  const extensao = /\.([a-z0-9]+)$/i.exec(nome)?.[1]?.toLowerCase() ?? "";
  const t = TIPOS[extensao];
  const m = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!t || !(GENERICOS.includes(m) || t.mimes.includes(m)))
    throw new ErroDeImportacao(
      "tipo_nao_aceito",
      `Tipo de arquivo não aceito (${nome}). Envie PDF, CSV, XLSX, XLS, TXT ou imagem (PNG, JPG, WEBP).`,
      415,
    );
  if (!assinaturaConfere(t.tipo, bytes))
    throw new ErroDeImportacao(
      "conteudo_invalido",
      `O conteúdo de ${nome} não corresponde à extensão.`,
      415,
    );
  return t.tipo;
}

export function conferirTamanho(bytes: number): void {
  if (bytes === 0) throw new ErroDeImportacao("vazio", "Arquivo vazio.");
  if (bytes > LIMITE_DE_BYTES)
    throw new ErroDeImportacao("grande_demais", "Arquivo acima de 10 MB.", 413);
}

export const hashDoConteudo = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
