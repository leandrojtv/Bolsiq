import { d } from "../decimal.js";
import { detectarParcela, normalizarDeExtrato } from "./normalizar.js";
import { leitorCsvC6 } from "./csv-c6.js";
import { leitorOfx } from "./ofx.js";
import {
  ErroDeLeitura,
  type ExtratoLido,
  type LeitorDeExtrato,
  type LinhaLida,
} from "./tipos.js";

export * from "./categorizar.js";
export { categoriaDoC6, dataC6, leitorCsvC6, valorC6 } from "./csv-c6.js";
export * from "./normalizar.js";
export { dataOfx, leitorOfx, valorOfx } from "./ofx.js";
export * from "./tipos.js";

/** Formatos aceitos. PDF entra aqui como novo leitor. */
export const LEITORES: LeitorDeExtrato[] = [leitorOfx, leitorCsvC6];

/**
 * Bytes -> texto. Banco brasileiro declara CHARSET:1252 e manda UTF-8, ou o
 * contrario; o cabecalho nao merece confianca. UTF-8 estrito primeiro, e se
 * falhar, windows-1252 (superconjunto pratico do latin1).
 */
export function decodificar(bytes: Uint8Array): string {
  let texto: string;
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    texto = new TextDecoder("windows-1252").decode(bytes);
  }
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

export function lerExtrato(bytes: Uint8Array, nome: string): ExtratoLido {
  const texto = decodificar(bytes);
  const leitor = LEITORES.find((l) => l.reconhece(texto, nome));
  if (!leitor)
    throw new ErroDeLeitura(
      "Formato não suportado: por enquanto, OFX e a fatura do C6 em CSV.",
    );
  return leitor.ler(texto, nome);
}

export interface LinhaProposta extends LinhaLida {
  tipo: "receita" | "despesa";
  descricao_normalizada: string;
  parcela_atual: number | null;
  parcela_total: number | null;
  /**
   * Ocorrencia da mesma (data, valor, sentido, descricao) no arquivo, a partir
   * de 1. Entra no hash: dois cafes iguais no mesmo dia sao duas linhas.
   */
  ordinal: number;
}

export function proporLinhas(extrato: ExtratoLido): LinhaProposta[] {
  const vistos = new Map<string, number>();
  return extrato.linhas.map((l) => {
    const descricao_normalizada = normalizarDeExtrato(l.descricao);
    const chave = `${l.data}|${l.sentido}|${l.valor}|${descricao_normalizada}`;
    const ordinal = (vistos.get(chave) ?? 0) + 1;
    vistos.set(chave, ordinal);
    const parcela = l.parcela !== undefined ? l.parcela : detectarParcela(l.descricao);
    return {
      ...l,
      tipo: l.sentido === "credito" ? "receita" : "despesa",
      descricao_normalizada,
      parcela_atual: parcela?.atual ?? null,
      parcela_total: parcela?.total ?? null,
      ordinal,
    };
  });
}

/**
 * Chave da deduplicacao de reserva, para quando o FITID falta ou muda entre
 * exportacoes. O servidor prefixa o usuario e tira o SHA-256.
 */
export function chaveDeDedupe(
  destino: string,
  l: Pick<
    LinhaProposta,
    "data" | "valor" | "sentido" | "descricao_normalizada" | "ordinal"
  >,
): string {
  const sinal = l.sentido === "debito" ? "-" : "";
  return [
    destino,
    l.data,
    `${sinal}${d(l.valor).toFixed(2)}`,
    l.descricao_normalizada,
    l.ordinal,
  ].join("|");
}

/** Pagamento de fatura e transferencia propria: sugere marcar como transferencia. */
export function pareceTransferencia(descricaoNormalizada: string): boolean {
  return /\b(PAGAMENTO|PAGTO|PGTO|PAG) (DE )?(FATURA|CARTAO)|PAGAMENTO (RECEBIDO|EFETUADO)|PGTO DEBITO CONTA|FATURA CARTAO|INCLUSAO DE PAGAMENTO|TRANSF\w* (ENTRE CONTAS|MESMA TITULARIDADE)/.test(
    descricaoNormalizada,
  );
}
