import { d } from "../decimal.js";
import { detectarParcela, marcacaoDe, normalizarDeExtrato } from "./normalizar.js";
import { leitorCsvC6 } from "./csv-c6.js";
import {
  cabecalhoDoCsv,
  leitorCsvInterConta,
  leitorCsvItauConta,
  leitorCsvMapeado,
  leitorCsvNubankCartao,
  leitorCsvNubankConta,
  PrecisaDeMapeamento,
} from "./csv.js";
import type { MapeamentoDeCsv } from "../contratos-importacao.js";
import { leitorOfx } from "./ofx.js";
import {
  ErroDeLeitura,
  type ExtratoLido,
  type LeitorDeExtrato,
  type LinhaLida,
} from "./tipos.js";

export * from "./categorizar.js";
export * from "./csv.js";
export { categoriaDoC6, dataC6, leitorCsvC6, valorC6 } from "./csv-c6.js";
export * from "./normalizar.js";
export { dataOfx, leitorOfx, valorOfx } from "./ofx.js";
export * from "./tipos.js";

/**
 * Formatos lidos sem IA. PDF e imagem nao passam por aqui: o assistente os le
 * (ADR 0040) e entrega um `ExtratoLido` para a mesma revisao.
 */
export const LEITORES: LeitorDeExtrato[] = [
  leitorOfx,
  leitorCsvC6,
  leitorCsvNubankCartao,
  leitorCsvNubankConta,
  leitorCsvInterConta,
  leitorCsvItauConta,
];

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

const pareceCsv = (nome: string) => /\.(csv|txt)$/i.test(nome);

/**
 * Leitor conhecido primeiro; depois o mapeamento salvo para o mesmo cabecalho;
 * CSV com cabecalho e sem mapeamento pede um (`PrecisaDeMapeamento`).
 */
export function lerExtrato(
  bytes: Uint8Array,
  nome: string,
  mapeamentos: MapeamentoDeCsv[] = [],
): ExtratoLido {
  const texto = decodificar(bytes);
  const leitor =
    LEITORES.find((l) => l.reconhece(texto, nome)) ??
    mapeamentos.map(leitorCsvMapeado).find((l) => l.reconhece(texto, nome));
  if (leitor) return leitor.ler(texto, nome);
  const csv = pareceCsv(nome) ? cabecalhoDoCsv(texto) : null;
  if (csv) {
    const { indice: _, ...cabecalho } = csv;
    throw new PrecisaDeMapeamento(nome, cabecalho);
  }
  throw new ErroDeLeitura(
    "Formato não suportado: OFX ou CSV aqui; PDF e foto vão pela leitura com IA.",
  );
}

export interface LinhaProposta extends LinhaLida {
  marcacao: NonNullable<LinhaLida["marcacao"]> | null;
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
      marcacao: l.marcacao ?? marcacaoDe(l.descricao, extrato.tipo ?? "conta", l.sentido),
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
