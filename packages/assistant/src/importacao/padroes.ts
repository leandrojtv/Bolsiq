import { Decimal } from "decimal.js";

/**
 * Politica de preenchimento dos campos que o documento nao traz (ADR 0027).
 * Cada regra marca o campo como "preenchido automaticamente": a revisao mostra
 * com cor propria, e o usuario ve o que veio do documento e o que veio daqui.
 *
 * NUNCA se inventa: saldo_bruto, ticker/codigo, quantidade de renda variavel,
 * preco e data de transacao. Sem eles, a linha vai para "precisa de ajuste" com
 * o campo destacado.
 */

export interface ContextoDoPreenchimento {
  /** Data do documento (cabecalho). */
  data_documento: string;
  /** Data do envio, AAAA-MM-DD em Sao Paulo. */
  hoje: string;
  /** Corretora escolhida no envio do arquivo. */
  corretora_escolhida: string;
  /** Nome do arquivo, ultima opcao para a corretora. */
  nome_do_arquivo: string;
}

export interface Preenchimento {
  dados: Record<string, string>;
  /** Campos que esta politica preencheu. */
  preenchidos: string[];
  avisos: string[];
}

/** A tabela, como documentada em docs/services/importacao-ia.md. */
export const POLITICA_DE_PREENCHIMENTO = [
  { campo: "ir, iof", valor: "0" },
  { campo: "quantidade (renda fixa, COE, estruturado)", valor: "1" },
  { campo: "preco_unitario", valor: "saldo_bruto / quantidade" },
  {
    campo: "valor_aplicado",
    valor: "saldo_bruto, com aviso de rentabilidade não calculável",
  },
  { campo: "saldo_liquido", valor: "saldo_bruto - ir - iof" },
  { campo: "data_posicao", valor: "data do documento; sem ela, a data do envio" },
  { campo: "corretora", valor: "a escolhida no envio; sem ela, o nome do arquivo" },
  { campo: "liquidez_diaria", valor: "N" },
  { campo: "valorizacao", valor: "pela classe" },
  { campo: "taxas (transação)", valor: "0" },
] as const;

/** Campos que a politica nunca preenche. */
export const NUNCA_INVENTAR = [
  "saldo_bruto",
  "codigo",
  "ticker",
  "quantidade (renda variável)",
  "preco (transação)",
  "data (transação)",
] as const;

const VALORIZACAO_DA_CLASSE: Record<string, string> = {
  acao: "cotacao_b3",
  fii: "cotacao_b3",
  bdr: "cotacao_b3",
  etf: "cotacao_b3",
  renda_fixa: "curva",
  titulo_publico: "tesouro",
  fundo: "cota_cvm",
  previdencia: "cota_cvm",
};

const QUANTIDADE_UM = ["renda_fixa", "coe", "estruturado"];

const decimal = (v: string | undefined): Decimal | null => {
  if (!v) return null;
  try {
    return new Decimal(v);
  } catch {
    return null;
  }
};

const corretoraPadrao = (c: ContextoDoPreenchimento) =>
  c.corretora_escolhida.trim() ||
  c.nome_do_arquivo
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_\-[\]]+/g, " ")
    .trim();

/** Aplica a politica a uma posicao ja normalizada. */
export function preencherPosicao(
  d: Record<string, string>,
  c: ContextoDoPreenchimento,
): Preenchimento {
  const dados = { ...d };
  const preenchidos: string[] = [];
  const avisos: string[] = [];
  const pre = (campo: string, valor: string) => {
    if ((dados[campo] ?? "") !== "" || valor === "") return;
    dados[campo] = valor;
    preenchidos.push(campo);
  };

  pre("data_posicao", c.data_documento || c.hoje);
  pre("corretora", corretoraPadrao(c));
  if (QUANTIDADE_UM.includes(dados.classe ?? "")) pre("quantidade", "1");
  pre("ir", "0");
  pre("iof", "0");
  pre("liquidez_diaria", "N");
  const valorizacao = VALORIZACAO_DA_CLASSE[dados.classe ?? ""] ?? "manual";
  pre("valorizacao", valorizacao);

  const saldo = decimal(dados.saldo_bruto);
  if (saldo) {
    const qtd = decimal(dados.quantidade);
    if (qtd && !qtd.isZero())
      pre("preco_unitario", saldo.div(qtd).toDecimalPlaces(8).toString());
    if (!dados.valor_aplicado) {
      pre("valor_aplicado", saldo.toFixed(2));
      avisos.push("Sem valor aplicado no documento: rentabilidade não calculável.");
    }
    const ir = decimal(dados.ir) ?? new Decimal(0);
    const iof = decimal(dados.iof) ?? new Decimal(0);
    pre("saldo_liquido", saldo.minus(ir).minus(iof).toFixed(2));
  }
  return { dados, preenchidos, avisos };
}

/** Transacao: so as taxas. Preco, data, ticker e quantidade nunca. */
export function preencherTransacao(
  d: Record<string, string>,
  c: ContextoDoPreenchimento,
): Preenchimento {
  const dados = { ...d };
  const preenchidos: string[] = [];
  if (!dados.taxas) {
    dados.taxas = "0";
    preenchidos.push("taxas");
  }
  if (!dados.corretora) {
    dados.corretora = corretoraPadrao(c);
    preenchidos.push("corretora");
  }
  return { dados, preenchidos, avisos: [] };
}
