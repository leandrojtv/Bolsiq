import { jsonSchema, zodSchema, type JSONSchema7, type Schema } from "ai";
import { z } from "zod";
import { COLUNAS_BOLSIQ, COLUNAS_POSICAO } from "@bolsiq/portfolio";

/**
 * O que o modelo devolve. Os campos sao os mesmos do layout de posicao
 * (`COLUNAS_POSICAO`) e do CSV de transacoes (`COLUNAS_BOLSIQ`), todos como texto
 * ou nulo: o tipo de verdade e de `LinhaDePosicao` e `Transacao`, que conferem
 * cada linha depois. Assim um campo errado rejeita a linha, nao a resposta
 * inteira, e o validador e um so para o CSV e para a IA.
 *
 * Tudo obrigatorio e anulavel, sem `optional`: a saida estruturada estrita da
 * OpenAI exige todos os campos em `required`.
 */
const texto = z.string().nullable();

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
  sentido_liquido: z.enum(["debito", "credito"]).nullable(),
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
    corretora: null,
    data_referencia: null,
    totais_declarados: [],
  },
  posicoes: [],
  transacoes: [],
  proventos: [],
  notas: [],
  avisos: [],
});

type No = JSONSchema7 | boolean;

/**
 * O schema que vai ao modelo, sem `null`: a Anthropic recusa mais de 16 campos
 * com union ("type" em lista ou `anyOf`), e aqui sao dezenas. O modelo devolve
 * "" no lugar do nulo e `vazioParaNulo` desfaz antes do Zod.
 */
export function semNulo(n: No): No {
  if (typeof n === "boolean") return n;
  const r: JSONSchema7 = { ...n };
  if (Array.isArray(r.type)) {
    const tipos = r.type.filter((t) => t !== "null");
    r.type = tipos.length === 1 ? tipos[0] : tipos;
  }
  if (r.enum) r.enum = [...new Set(r.enum.map((v) => (v === null ? "" : v)))];
  for (const k of ["anyOf", "oneOf"] as const) {
    const opcoes = r[k]?.filter((o) => !(typeof o === "object" && o.type === "null"));
    if (!opcoes) continue;
    delete r[k];
    if (opcoes.length === 1) Object.assign(r, semNulo(opcoes[0]!));
    else r[k] = opcoes.map(semNulo);
  }
  if (r.properties)
    r.properties = Object.fromEntries(
      Object.entries(r.properties).map(([k, v]) => [k, semNulo(v)]),
    );
  if (r.items && !Array.isArray(r.items)) r.items = semNulo(r.items);
  return r;
}

/** "" vira null onde o schema aceita null; o resto passa como veio. */
export function vazioParaNulo(s: z.ZodTypeAny, v: unknown): unknown {
  if (s instanceof z.ZodNullable)
    return v === "" ? null : vazioParaNulo(s.unwrap() as z.ZodTypeAny, v);
  if (s instanceof z.ZodArray && Array.isArray(v))
    return v.map((x) => vazioParaNulo(s.element as z.ZodTypeAny, x));
  if (s instanceof z.ZodObject && v && typeof v === "object" && !Array.isArray(v)) {
    const forma = s.shape as Record<string, z.ZodTypeAny>;
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, forma[k] ? vazioParaNulo(forma[k], x) : x]),
    );
  }
  return v;
}

export const SaidaDaIAParaOModelo: Schema<SaidaDaIA> = jsonSchema<SaidaDaIA>(
  async () => semNulo(await zodSchema(SaidaDaIA).jsonSchema) as JSONSchema7,
  {
    validate: (v) => {
      const r = SaidaDaIA.safeParse(vazioParaNulo(SaidaDaIA, v));
      return r.success
        ? { success: true, value: r.data }
        : { success: false, error: r.error };
    },
  },
);
