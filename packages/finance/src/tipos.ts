export const TIPOS_DE_CONTA = [
  { tipo: "corrente", rotulo: "Conta corrente" },
  { tipo: "poupanca", rotulo: "Poupança" },
  { tipo: "carteira", rotulo: "Carteira (dinheiro)" },
  { tipo: "beneficio", rotulo: "Benefício (VR, VA)" },
  { tipo: "caixa_corretora", rotulo: "Caixa da corretora" },
] as const;
export type TipoDeConta = (typeof TIPOS_DE_CONTA)[number]["tipo"];

export const NATUREZAS = ["receita", "despesa"] as const;
export type Natureza = (typeof NATUREZAS)[number];

export const TIPOS_DE_CUSTO = ["fixo", "variavel"] as const;
export type TipoDeCusto = (typeof TIPOS_DE_CUSTO)[number];

export const TIPOS_DE_LANCAMENTO = ["receita", "despesa", "transferencia"] as const;
export type TipoDeLancamento = (typeof TIPOS_DE_LANCAMENTO)[number];

export const STATUS_DE_LANCAMENTO = ["previsto", "realizado", "conciliado"] as const;
export type StatusDeLancamento = (typeof STATUS_DE_LANCAMENTO)[number];

export const SENTIDOS = ["saida", "entrada"] as const;
export type Sentido = (typeof SENTIDOS)[number];

/** O minimo de um lancamento que as funcoes de saldo e total precisam. */
export interface LancamentoBase {
  tipo: TipoDeLancamento;
  valor: string;
  data: string;
  competencia: string;
  status: StatusDeLancamento;
  transferencia_sentido: Sentido | null;
}
