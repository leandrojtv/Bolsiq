import { z } from "zod";
import { valorDigitado } from "./decimal.js";
import {
  NATUREZAS,
  SENTIDOS,
  STATUS_DE_LANCAMENTO,
  TIPOS_DE_CONTA,
  TIPOS_DE_CUSTO,
  TIPOS_DE_LANCAMENTO,
  type TipoDeConta,
} from "./tipos.js";

/**
 * Schemas Zod do BFF /api/financas: o navegador valida o que digitou e o BFF
 * valida de novo o texto recebido. Os de resposta alimentam o OpenAPI.
 */

const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida");
const Id = z.string().min(1).max(64);
const Dinheiro = z.string().regex(/^-?\d+\.\d{2}$/);
const Cor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "cor inválida")
  .nullable()
  .optional();
const textoOpcional = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max).nullable().optional(),
  );

/** Valor positivo digitado em pt-BR. */
const ValorPositivo = z.string().transform((v, ctx) => {
  const n = valorDigitado(v);
  if (n === null || Number(n) <= 0) {
    ctx.addIssue({ code: "custom", message: "valor inválido" });
    return z.NEVER;
  }
  return n;
});

/** Saldo pode ser negativo (cheque especial). */
const Saldo = z.string().transform((v, ctx) => {
  const t = v.trim();
  const negativo = t.startsWith("-");
  const n = valorDigitado(negativo ? t.slice(1) : t);
  if (n === null) {
    ctx.addIssue({ code: "custom", message: "saldo inválido" });
    return z.NEVER;
  }
  return negativo && Number(n) !== 0 ? `-${n}` : n;
});

const TipoDeContaZ = z.enum(
  TIPOS_DE_CONTA.map((t) => t.tipo) as [TipoDeConta, ...TipoDeConta[]],
);

export const NovaConta = z.object({
  nome: z.string().trim().min(1, "informe o nome").max(60),
  tipo: TipoDeContaZ,
  instituicao: textoOpcional(60),
  saldo_inicial: Saldo.default("0"),
  data_saldo_inicial: Data,
  cor: Cor,
});
export type NovaConta = z.infer<typeof NovaConta>;

export const EdicaoDeConta = NovaConta.partial().extend({
  arquivada: z.boolean().optional(),
});
export type EdicaoDeConta = z.infer<typeof EdicaoDeConta>;

export const NovaCategoria = z.object({
  nome: z.string().trim().min(1, "informe o nome").max(60),
  natureza: z.enum(NATUREZAS),
  tipo_custo: z.enum(TIPOS_DE_CUSTO).default("variavel"),
  essencial: z.boolean().default(false),
  parent_id: Id.nullable().optional(),
  cor: Cor,
  icone: textoOpcional(40),
});
export type NovaCategoria = z.infer<typeof NovaCategoria>;

export const EdicaoDeCategoria = z.object({
  nome: z.string().trim().min(1, "informe o nome").max(60).optional(),
  natureza: z.enum(NATUREZAS).optional(),
  tipo_custo: z.enum(TIPOS_DE_CUSTO).optional(),
  essencial: z.boolean().optional(),
  parent_id: Id.nullable().optional(),
  cor: Cor,
  icone: textoOpcional(40),
  arquivada: z.boolean().optional(),
});
export type EdicaoDeCategoria = z.infer<typeof EdicaoDeCategoria>;

export const NovoLancamento = z
  .object({
    tipo: z.enum(TIPOS_DE_LANCAMENTO),
    valor: ValorPositivo,
    data: Data,
    descricao: z.string().trim().min(1, "informe a descrição").max(200),
    /** Conta ou cartao: exatamente um. Cartao so recebe receita e despesa. */
    account_id: Id.optional(),
    card_id: Id.optional(),
    /** So na transferencia: a conta que recebe, ou o cartao cuja fatura e paga. */
    conta_destino_id: Id.optional(),
    cartao_destino_id: Id.optional(),
    category_id: Id.nullable().optional(),
    status: z.enum(STATUS_DE_LANCAMENTO).default("realizado"),
    observacao: textoOpcional(500),
  })
  .superRefine((l, ctx) => {
    if (!l.account_id === !l.card_id)
      ctx.addIssue({
        code: "custom",
        path: ["account_id"],
        message: "escolha a conta ou o cartão",
      });
    if (l.tipo !== "transferencia") return;
    if (l.card_id)
      ctx.addIssue({
        code: "custom",
        path: ["card_id"],
        message: "transferência sai de uma conta",
      });
    if (!l.conta_destino_id === !l.cartao_destino_id)
      ctx.addIssue({
        code: "custom",
        path: ["conta_destino_id"],
        message: "escolha a conta de destino",
      });
    else if (l.conta_destino_id === l.account_id)
      ctx.addIssue({
        code: "custom",
        path: ["conta_destino_id"],
        message: "origem e destino iguais",
      });
  });
export type NovoLancamento = z.infer<typeof NovoLancamento>;
export type LancamentoDigitado = z.input<typeof NovoLancamento>;

export const EdicaoDeLancamento = z.object({
  valor: ValorPositivo.optional(),
  data: Data.optional(),
  descricao: z.string().trim().min(1, "informe a descrição").max(200).optional(),
  account_id: Id.optional(),
  category_id: Id.nullable().optional(),
  status: z.enum(STATUS_DE_LANCAMENTO).optional(),
  observacao: textoOpcional(500),
});
export type EdicaoDeLancamento = z.infer<typeof EdicaoDeLancamento>;
export type EdicaoDigitada = z.input<typeof EdicaoDeLancamento>;

export const FiltroDeLancamentos = z.object({
  de: Data.optional(),
  ate: Data.optional(),
  conta: Id.optional(),
  cartao: Id.optional(),
  fatura: Id.optional(),
  importacao: Id.optional(),
  categoria: Id.optional(),
  status: z.enum(STATUS_DE_LANCAMENTO).optional(),
  q: z.string().trim().max(100).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  por_pagina: z.coerce.number().int().min(1).max(200).default(50),
});
export type FiltroDeLancamentos = z.infer<typeof FiltroDeLancamentos>;

export const ParametroId = z.object({ id: Id });
export const ParametroMes = z.object({
  mes: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "mês inválido")
    .optional(),
});

// Respostas

export const Conta = z.object({
  id: Id,
  nome: z.string(),
  tipo: TipoDeContaZ,
  instituicao: z.string().nullable(),
  saldo_inicial: Dinheiro,
  data_saldo_inicial: Data,
  cor: z.string().nullable(),
  arquivada: z.boolean(),
  /** Saldo realizado no fim de hoje (America/Sao_Paulo). */
  saldo_atual: Dinheiro,
});
export type Conta = z.infer<typeof Conta>;

export const Categoria = z.object({
  id: Id,
  parent_id: Id.nullable(),
  nome: z.string(),
  natureza: z.enum(NATUREZAS),
  tipo_custo: z.enum(TIPOS_DE_CUSTO),
  essencial: z.boolean(),
  cor: z.string().nullable(),
  icone: z.string().nullable(),
  sistema: z.boolean(),
  arquivada: z.boolean(),
});
export type Categoria = z.infer<typeof Categoria>;

export const Lancamento = z.object({
  id: Id,
  account_id: Id.nullable(),
  card_id: Id.nullable(),
  statement_id: Id.nullable(),
  tipo: z.enum(TIPOS_DE_LANCAMENTO),
  valor: Dinheiro,
  data: Data,
  competencia: Data,
  descricao: z.string(),
  category_id: Id.nullable(),
  status: z.enum(STATUS_DE_LANCAMENTO),
  transferencia_par_id: Id.nullable(),
  transferencia_sentido: z.enum(SENTIDOS).nullable(),
  observacao: z.string().nullable(),
});
export type Lancamento = z.infer<typeof Lancamento>;

const TotalPorStatus = z.object({
  previsto: Dinheiro,
  realizado: Dinheiro,
  total: Dinheiro,
});

export const ResumoDoMes = z.object({
  competencia: Data,
  receita: TotalPorStatus,
  despesa: TotalPorStatus,
  resultado: Dinheiro,
  contas: z.array(z.object({ id: Id, nome: z.string(), saldo: Dinheiro })),
});
export type ResumoDoMes = z.infer<typeof ResumoDoMes>;

export const RespostaDe = <T extends z.ZodTypeAny>(s: T) => z.object({ data: s });
export const PaginaDeLancamentos = z.object({
  data: z.array(Lancamento),
  meta: z.object({
    pagina: z.number().int(),
    por_pagina: z.number().int(),
    total: z.number().int(),
  }),
});
export type PaginaDeLancamentos = z.infer<typeof PaginaDeLancamentos>;
export const Vazio = z.null().describe("204 sem corpo");
