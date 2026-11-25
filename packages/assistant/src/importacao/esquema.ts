import { z } from "zod";
import { COLUNAS_BOLSIQ, COLUNAS_POSICAO } from "@bolsiq/portfolio";

/**
 * Estrutura INTERNA da extracao: o que o parser monta a partir dos blocos CSV
 * que o modelo devolve, e o que fica no cache. Nao vai ao modelo como schema:
 * a saida estruturada estrita compila o schema numa gramatica, e um schema com
 * 26 campos por linha em quatro listas passa do limite dos provedores (ADR 0026,
 * Revisao). O unico schema enviado e `CabecalhoDaIA`.
 *
 * Os campos sao os do layout de posicao (`COLUNAS_POSICAO`) e do CSV de
 * transacoes (`COLUNAS_BOLSIQ`), como texto; vazio e "nao informado". O tipo de
 * verdade e de `LinhaDePosicao` e `Transacao`, que conferem cada linha depois.
 */
const texto = z.string();

export const Confianca = z.enum(["alta", "media", "baixa"]);
export type Confianca = z.infer<typeof Confianca>;

export const Origem = z.object({
  pagina_ou_aba: z
    .string()
    .describe('Exatamente como no marcador: "página 2", "aba Ações" ou "texto"'),
  trecho_original: z
    .string()
    .describe(
      "Copiado do documento, sem mudar nada, até 200 caracteres, com o ativo e os valores da linha",
    ),
});
export type Origem = z.infer<typeof Origem>;

const camposDe = <K extends string>(nomes: readonly K[]) =>
  Object.fromEntries(nomes.map((n) => [n, texto])) as Record<K, typeof texto>;

export const PosicaoDaIA = z.object({
  ...camposDe(COLUNAS_POSICAO),
  origem: Origem,
  confianca: Confianca,
});
export type PosicaoDaIA = z.infer<typeof PosicaoDaIA>;

export const TransacaoDaIA = z.object({
  ...camposDe(COLUNAS_BOLSIQ),
  ativo_no_documento: texto.describe(
    "O nome do papel como está no documento, se não for o ticker",
  ),
  nota: texto.describe("Número da nota de corretagem, se a operação veio de uma"),
  origem: Origem,
  confianca: Confianca,
});
export type TransacaoDaIA = z.infer<typeof TransacaoDaIA>;

export const ProventoDaIA = z.object({
  data_pagamento: texto,
  ticker: texto,
  tipo: texto.describe("dividendo, jcp, rendimento ou outro"),
  quantidade: texto,
  valor_por_cota: texto,
  valor_total: texto,
  corretora: texto,
  origem: Origem,
  confianca: Confianca,
});
export type ProventoDaIA = z.infer<typeof ProventoDaIA>;

export const NotaDaIA = z.object({
  numero: z.string(),
  data_pregao: texto,
  corretora: texto,
  taxas_total: texto.describe("Soma de todas as taxas e custos da nota, sem o IRRF"),
  irrf: texto,
  valor_liquido: texto,
  sentido_liquido: z.enum(["debito", "credito", ""]),
  origem: Origem,
});
export type NotaDaIA = z.infer<typeof NotaDaIA>;

export const TipoDeDocumento = z.enum([
  "posicao",
  "transacoes",
  "nota_corretagem",
  "proventos",
  "misto",
  // Bolsiq Financas (ADR 0040): o mesmo pipeline, outro prompt e outras linhas.
  "fatura_cartao",
  "extrato_conta",
]);

export const TipoDeDocumentoFinancas = z.enum(["fatura_cartao", "extrato_conta"]);
export type TipoDeDocumentoFinancas = z.infer<typeof TipoDeDocumentoFinancas>;

/**
 * Uma linha de fatura de cartao ou de extrato de conta. `valor` sempre positivo
 * e `sinal` diz o lado (debito sai, credito entra). Compra internacional traz a
 * moeda e o valor de origem; o IOF vem em linha propria.
 */
export const LancamentoDaIA = z.object({
  data: texto,
  descricao: texto,
  valor: texto,
  sinal: texto.describe("debito ou credito"),
  parcela_atual: texto,
  parcela_total: texto,
  moeda_original: texto,
  valor_moeda_original: texto,
  origem: Origem,
  confianca: Confianca,
});
export type LancamentoDaIA = z.infer<typeof LancamentoDaIA>;

/**
 * O cabecalho da fatura ou do extrato, o unico schema que vai ao provedor na
 * importacao do Financas: nove propriedades (o teste reprova acima de 10).
 */
export const CabecalhoFinancasDaIA = z.object({
  banco: z.string(),
  tipo: TipoDeDocumentoFinancas,
  final_cartao: z.string(),
  data_fechamento: z.string(),
  data_vencimento: z.string(),
  total_fatura: z.string(),
  periodo_inicio: z.string(),
  periodo_fim: z.string(),
  avisos: z.array(z.string()),
});
export type CabecalhoFinancasDaIA = z.infer<typeof CabecalhoFinancasDaIA>;
export type DocumentoFinancas = Omit<CabecalhoFinancasDaIA, "avisos">;

export const SaidaDaIA = z.object({
  documento: z.object({
    tipo: TipoDeDocumento,
    corretora: texto,
    data_referencia: texto,
    totais_declarados: z.array(z.object({ descricao: z.string(), valor: z.string() })),
    /** Fatura ou extrato do Financas: o cabecalho como o modelo leu. */
    financas: CabecalhoFinancasDaIA.omit({ avisos: true }).optional(),
  }),
  posicoes: z.array(PosicaoDaIA),
  transacoes: z.array(TransacaoDaIA),
  proventos: z.array(ProventoDaIA),
  notas: z.array(NotaDaIA),
  lancamentos: z.array(LancamentoDaIA).default([]),
  avisos: z.array(z.string()),
  /** Lotes que falharam (provedor fora, resposta ilegivel): a revisao oferece reprocessar. */
  lotes_falhos: z
    .array(
      z.object({ indice: z.number(), origens: z.array(z.string()), motivo: z.string() }),
    )
    .default([]),
  /** Linhas dos blocos CSV que o parser nao conseguiu ler: viram rejeicao. */
  malformadas: z
    .array(z.object({ tipo: z.string(), motivo: z.string(), conteudo: z.string() }))
    .default([]),
});
export type SaidaDaIA = z.infer<typeof SaidaDaIA>;

export const saidaVazia = (): SaidaDaIA => ({
  documento: {
    tipo: "misto",
    corretora: "",
    data_referencia: "",
    totais_declarados: [],
  },
  posicoes: [],
  transacoes: [],
  proventos: [],
  notas: [],
  lancamentos: [],
  avisos: [],
  malformadas: [],
  lotes_falhos: [],
});

/**
 * O unico schema que vai ao provedor: o cabecalho do documento, pedido uma vez,
 * com as primeiras e as ultimas paginas. Sete propriedades, nenhuma anulavel.
 */
export const CabecalhoDaIA = z.object({
  tipo: TipoDeDocumento,
  corretora: z.string(),
  data_referencia: z.string(),
  totais_declarados: z.array(z.object({ descricao: z.string(), valor: z.string() })),
  avisos: z.array(z.string()),
});
export type CabecalhoDaIA = z.infer<typeof CabecalhoDaIA>;

const ORIGEM = ["pagina_ou_aba", "trecho_original", "confianca"] as const;

/** Colunas de cada bloco ```csv <tipo>```, na ordem em que o prompt pede. */
export const COLUNAS_DO_BLOCO = {
  posicoes: [...COLUNAS_POSICAO, ...ORIGEM],
  transacoes: [...COLUNAS_BOLSIQ, "ativo_no_documento", "nota", ...ORIGEM],
  proventos: [
    "data_pagamento",
    "ticker",
    "tipo",
    "quantidade",
    "valor_por_cota",
    "valor_total",
    "corretora",
    ...ORIGEM,
  ],
  notas: [
    "numero",
    "data_pregao",
    "corretora",
    "taxas_total",
    "irrf",
    "valor_liquido",
    "sentido_liquido",
    "pagina_ou_aba",
    "trecho_original",
  ],
  lancamentos: [
    "data",
    "descricao",
    "valor",
    "sinal",
    "parcela_atual",
    "parcela_total",
    "moeda_original",
    "valor_moeda_original",
    ...ORIGEM,
  ],
} as const;
export type TipoDeBloco = keyof typeof COLUNAS_DO_BLOCO;
export const TIPOS_DE_BLOCO = Object.keys(COLUNAS_DO_BLOCO) as TipoDeBloco[];
