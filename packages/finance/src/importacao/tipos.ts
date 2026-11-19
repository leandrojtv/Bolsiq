/**
 * Contrato entre um leitor de formato (OFX hoje; CSV e PDF depois) e o resto da
 * importacao. A revisao, a deduplicacao e a categorizacao so conhecem
 * `ExtratoLido`: formato novo e um leitor novo, sem mexer nelas.
 */

export type TipoDeExtrato = "conta" | "cartao";

export interface LinhaLida {
  /** Posicao da linha no arquivo, a partir de 0. */
  indice: number;
  fitid: string | null;
  /** Tipo informado pelo banco (CREDIT, DEBIT, PAYMENT...). So informativo. */
  trntype: string | null;
  /** YYYY-MM-DD, a data local do banco. */
  data: string;
  /** Sempre positivo, com duas casas. */
  valor: string;
  /** credito entra (receita, estorno, pagamento); debito sai. */
  sentido: "credito" | "debito";
  /** NAME + MEMO quando os dois existem. */
  descricao: string;
}

export interface ExtratoLido {
  formato: string;
  /** null quando o arquivo nao diz (o usuario escolhe). */
  tipo: TipoDeExtrato | null;
  /** BANKID (codigo COMPE) ou ORG do FI, para sugerir o destino. */
  banco: string | null;
  /** ACCTID: conta ou numero (mascarado) do cartao. */
  conta: string | null;
  inicio: string | null;
  fim: string | null;
  /** LEDGERBAL: saldo informado pelo banco no fim do periodo. */
  saldo: { valor: string; data: string } | null;
  linhas: LinhaLida[];
  avisos: string[];
}

export interface LeitorDeExtrato {
  formato: string;
  reconhece(texto: string, nome: string): boolean;
  ler(texto: string): ExtratoLido;
}

export class ErroDeLeitura extends Error {}
