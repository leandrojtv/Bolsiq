/**
 * Contrato entre um leitor de formato (OFX, CSV por banco, CSV mapeado e a
 * leitura de PDF e imagem do assistente) e o resto da
 * importacao. A revisao, a deduplicacao e a categorizacao so conhecem
 * `ExtratoLido`: formato novo e um leitor novo, sem mexer nelas.
 */

export type TipoDeExtrato = "conta" | "cartao";

/**
 * Linha que nao e compra nem receita comum. pagamento: quita a fatura anterior;
 * estorno: credito que devolve uma compra; saldo_anterior: so informativo, nunca
 * entra; iof: imposto da compra internacional, em lancamento proprio.
 */
export const MARCACOES = ["pagamento", "estorno", "saldo_anterior", "iof"] as const;
export type Marcacao = (typeof MARCACOES)[number];

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
  /**
   * Parcela informada em coluna propria (CSV do C6). undefined: o leitor nao
   * sabe, e a parcela sai da descricao; null: compra a vista.
   */
  parcela?: { atual: number; total: number } | null;
  /**
   * Nome de categoria padrao do Bolsiq sugerido pelo banco (ou pelo leitor,
   * como IOF e anuidade). So vale quando nenhuma regra nem o historico casam.
   */
  categoria_sugerida?: string | null;
  marcacao?: Marcacao | null;
  /** Compra internacional: moeda (ISO 4217) e valor na moeda, positivo. */
  moeda_original?: string | null;
  valor_moeda_original?: string | null;
  /** Por que a linha merece um olhar (confianca baixa, total que nao fecha). */
  aviso?: string | null;
  /** Lida de imagem ou com duvida: chega desmarcada na revisao. */
  confianca?: "alta" | "media" | "baixa";
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
  /** Vencimento da fatura, quando o arquivo diz (nome do CSV do C6). */
  vencimento?: string | null;
  fechamento?: string | null;
  /** Total da fatura escrito no documento, positivo: a revisao confere a soma. */
  total_informado?: string | null;
  /** Cabecalho do CSV lido por um mapeamento salvo (leitor generico). */
  assinatura?: string;
}

export interface LeitorDeExtrato {
  formato: string;
  reconhece(texto: string, nome: string): boolean;
  ler(texto: string, nome: string): ExtratoLido;
}

export class ErroDeLeitura extends Error {}
