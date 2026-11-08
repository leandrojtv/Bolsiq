import { z } from "zod";
import { COLUNAS_BOLSIQ, COLUNAS_POSICAO } from "@bolsiq/portfolio";

/**
 * O que o modelo devolve. Os campos sao os mesmos do layout de posicao
 * (`COLUNAS_POSICAO`) e do CSV de transacoes (`COLUNAS_BOLSIQ`), todos como texto:
 * o tipo de verdade e de `LinhaDePosicao` e `Transacao`, que conferem cada linha
 * depois. Assim um campo errado rejeita a linha, nao a resposta inteira, e o
 * validador e um so para o CSV e para a IA.
 *
 * Tudo obrigatorio e texto, sem `optional` nem `nullable`: vazio e "nao
 * informado", como no CSV. A saida estruturada estrita da OpenAI exige todos os
 * campos em `required`, e a da Anthropic aceita no maximo 16 campos com uniao de
 * tipos (`string | null` e uniao); com 24 colunas anulaveis o schema era recusado.
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
]);

export const SaidaDaIA = z.object({
  documento: z.object({
    tipo: TipoDeDocumento,
    corretora: texto,
    data_referencia: texto,
    totais_declarados: z.array(z.object({ descricao: z.string(), valor: z.string() })),
  }),
  posicoes: z.array(PosicaoDaIA),
  transacoes: z.array(TransacaoDaIA),
  proventos: z.array(ProventoDaIA),
  notas: z.array(NotaDaIA),
  avisos: z.array(z.string()),
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
  avisos: [],
});
