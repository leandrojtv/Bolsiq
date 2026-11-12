import { createHash } from "node:crypto";
import type { Uso } from "../orcamento.js";

/**
 * Limites do envio, configuraveis por ambiente (ASSISTANT_IMPORT_MAX_MB,
 * _MAX_PAGES, _MAX_FILES). O processamento e em segundo plano (ADR 0027): o
 * limite e de memoria e de custo, nao de tempo de requisicao.
 */
export interface Limites {
  bytes: number;
  paginas: number;
  arquivos: number;
}

export const LIMITES_PADRAO: Limites = {
  bytes: 50 * 1024 * 1024,
  paginas: 500,
  arquivos: 20,
};

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

export type TipoDeArquivo = "csv" | "txt" | "xlsx" | "xls" | "ods" | "pdf" | "imagem";

export class ErroDeImportacao extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
    readonly status = 422,
    /** Tokens ja gastos antes da falha: entram no consumo do mesmo jeito. */
    readonly uso: Uso | null = null,
    /** Texto tecnico do provedor, ja limpo: vai para o log, nunca para a tela. */
    readonly detalhe: string | null = null,
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
  ods: { tipo: "ods", mimes: ["application/vnd.oasis.opendocument.spreadsheet"] },
  heic: { tipo: "imagem", mimes: ["image/heic", "image/heif"] },
  heif: { tipo: "imagem", mimes: ["image/heic", "image/heif"] },
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
    case "ods":
      return comeca(0x50, 0x4b);
    case "xls":
      return comeca(0xd0, 0xcf, 0x11, 0xe0);
    case "imagem":
      return (
        comeca(0x89, 0x50, 0x4e, 0x47) ||
        comeca(0xff, 0xd8, 0xff) ||
        (comeca(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45) ||
        // HEIC/HEIF: caixa "ftyp" no byte 4.
        (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70)
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
      `Tipo de arquivo não aceito (${nome}). Envie PDF, CSV, XLSX, XLS, ODS, TXT ou imagem (PNG, JPG, WEBP, HEIC).`,
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

export function conferirTamanho(bytes: number, limite = LIMITES_PADRAO.bytes): void {
  if (bytes === 0) throw new ErroDeImportacao("vazio", "Arquivo vazio.");
  if (bytes > limite)
    throw new ErroDeImportacao(
      "grande_demais",
      `Arquivo acima de ${mb(limite)}. Divida o arquivo por período ou por conta.`,
      413,
    );
}

export const hashDoConteudo = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
