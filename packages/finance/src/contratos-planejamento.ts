import { z } from "zod";
import { valorDigitado } from "./decimal.js";
import { FREQUENCIAS } from "./recorrencia.js";
import { Lancamento } from "./contratos.js";
import { ResumoDeFatura } from "./contratos-importacao.js";

/** Schemas de recorrencia, fatura (detalhe e pagamento), painel e planejamento. */

const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida");
const Id = z.string().min(1).max(64);
const Dinheiro = z.string().regex(/^-?\d+\.\d{2}$/);
const Mes = z.string().regex(/^\d{4}-\d{2}$/, "mês inválido");
const valor = (min: "positivo" | "zero") =>
  z.string().transform((v, ctx) => {
    const n = valorDigitado(v);
    if (n === null || (min === "positivo" ? Number(n) <= 0 : Number(n) < 0)) {
      ctx.addIssue({ code: "custom", message: "valor inválido" });
      return z.NEVER;
    }
    return n;
  });
const vazioNulo = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

// Recorrencias

const CamposDeRecorrencia = z.object({
  tipo: z.enum(["receita", "despesa"]),
  descricao: z.string().trim().min(1, "informe a descrição").max(200),
  valor: valor("positivo"),
  category_id: z.preprocess(vazioNulo, Id.nullable().optional()),
  account_id: Id.optional(),
  card_id: Id.optional(),
  frequencia: z.enum(FREQUENCIAS).default("mensal"),
  dia: z.coerce.number().int().min(1, "dia inválido").max(31, "dia inválido"),
  inicio: Data,
  fim: z.preprocess(vazioNulo, Data.nullable().optional()),
  valor_variavel: z.boolean().default(false),
  ativa: z.boolean().default(true),
});

const regrasDaRecorrencia = (
  r: {
    frequencia?: string | undefined;
    dia?: number | undefined;
    inicio?: string | undefined;
    fim?: string | null | undefined;
  },
  ctx: z.RefinementCtx,
) => {
  if (r.frequencia === "semanal" && r.dia !== undefined && r.dia > 7)
    ctx.addIssue({
      code: "custom",
      path: ["dia"],
      message: "na semanal, dia de 1 (segunda) a 7",
    });
  if (r.fim && r.inicio && r.fim < r.inicio)
    ctx.addIssue({ code: "custom", path: ["fim"], message: "fim antes do início" });
};

export const NovaRecorrencia = CamposDeRecorrencia.superRefine((r, ctx) => {
  if (!r.account_id === !r.card_id)
    ctx.addIssue({
      code: "custom",
      path: ["account_id"],
      message: "escolha a conta ou o cartão",
    });
  if (r.card_id && r.tipo === "receita")
    ctx.addIssue({ code: "custom", path: ["tipo"], message: "no cartão, só despesa" });
  regrasDaRecorrencia(r, ctx);
});
export type NovaRecorrencia = z.infer<typeof NovaRecorrencia>;
export type RecorrenciaDigitada = z.input<typeof NovaRecorrencia>;

export const EdicaoDeRecorrencia = CamposDeRecorrencia.omit({
  account_id: true,
  card_id: true,
})
  .partial()
  .superRefine(regrasDaRecorrencia);
export type EdicaoDeRecorrencia = z.infer<typeof EdicaoDeRecorrencia>;

export const Recorrencia = z.object({
  id: Id,
  tipo: z.enum(["receita", "despesa"]),
  descricao: z.string(),
  valor: Dinheiro,
  category_id: Id.nullable(),
  account_id: Id.nullable(),
  card_id: Id.nullable(),
  frequencia: z.enum(FREQUENCIAS),
  dia: z.number().int(),
  inicio: Data,
  fim: Data.nullable(),
  valor_variavel: z.boolean(),
  ativa: z.boolean(),
  /** Valor de um mes cheio (semanal conta 52/12 semanas). */
  valor_mensal: Dinheiro,
  proxima: Data.nullable(),
});
export type Recorrencia = z.infer<typeof Recorrencia>;

export const ListaDeRecorrencias = z.object({
  data: z.array(Recorrencia),
  totais: z.object({ receitas_mensais: Dinheiro, despesas_mensais: Dinheiro }),
});
export type ListaDeRecorrencias = z.infer<typeof ListaDeRecorrencias>;

// Fatura

export const DetalheDaFatura = z.object({
  card_id: Id,
  fatura: ResumoDeFatura,
  conta_pagadora: Id.nullable(),
  lancamentos: z.array(Lancamento),
  por_categoria: z.array(
    z.object({ category_id: Id.nullable(), nome: z.string(), valor: Dinheiro }),
  ),
});
export type DetalheDaFatura = z.infer<typeof DetalheDaFatura>;

export const PagamentoDeFatura = z.object({
  account_id: Id.optional(),
  data: Data,
  /** Padrao: o total da fatura menos o que ja foi pago. */
  valor: valor("positivo").optional(),
});
export type PagamentoDeFatura = z.infer<typeof PagamentoDeFatura>;

export const ParametroFatura = z.object({ id: Id, fatura: Id });

// Painel do mes

export const ParametroDoMes = z.object({ mes: Mes.optional() });

export const PainelDoMes = z.object({
  competencia: Data,
  renda: z.object({ prevista: Dinheiro, recebida: Dinheiro }),
  despesas: z.object({ pagas: Dinheiro, a_pagar: Dinheiro, total: Dinheiro }),
  /** Soma das contas no fim do mes, com os previstos. */
  saldo_previsto_fim_do_mes: Dinheiro,
  fixos: z.object({ valor: Dinheiro, percentual_da_renda: z.number().nullable() }),
  variaveis: z.object({ valor: Dinheiro, percentual_da_renda: z.number().nullable() }),
  contas: z.array(z.object({ id: Id, nome: z.string(), saldo: Dinheiro })),
  faturas_abertas: z.array(
    z.object({
      id: Id,
      card_id: Id,
      cartao: z.string(),
      vencimento: Data,
      status: z.enum(["aberta", "fechada", "paga"]),
      total: Dinheiro,
    }),
  ),
  top_categorias: z.array(
    z.object({ category_id: Id.nullable(), nome: z.string(), valor: Dinheiro }),
  ),
  /** Orcamento de despesas do mes: planejado e consumido (realizado + previsto). */
  orcamento: z.object({
    planejado: Dinheiro,
    consumo: Dinheiro,
    percentual: z.number().nullable(),
    estado: z.enum(["ok", "atencao", "estourado"]),
  }),
  /** Parcelas (cartao, emprestimo, financiamento) que caem no mes. */
  comprometido_parcelas: Dinheiro,
  /** Previstos de saida nas contas ate 7 dias a frente (e os atrasados). */
  a_pagar: z.array(
    z.object({
      id: Id,
      data: Data,
      descricao: z.string(),
      valor: Dinheiro,
      conta: z.string(),
      atrasado: z.boolean(),
    }),
  ),
});
export type PainelDoMes = z.infer<typeof PainelDoMes>;

// Planejamento

export const NovoItemDoPlanejamento = z.object({
  mes: Mes,
  category_id: Id,
  descricao: z.preprocess(vazioNulo, z.string().trim().max(120).nullable().optional()),
  /** Valor fechado; com `parte_propria`, so esse percentual entra no orcamento. */
  valor: valor("zero"),
  fixo: z.boolean().default(false),
  /** Percentual que e seu quando o custo e dividido (ex.: 50). Vazio: nao dividido. */
  parte_propria: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.replace(",", ".")) : v),
    z.coerce
      .number({ invalid_type_error: "percentual inválido" })
      .gt(0, "a sua parte deve ser maior que 0%")
      .lt(100, "a sua parte deve ser menor que 100%")
      .multipleOf(0.01, "use até 2 casas decimais")
      .nullable()
      .optional(),
  ),
});
export type NovoItemDoPlanejamento = z.infer<typeof NovoItemDoPlanejamento>;
export type ItemDigitado = z.input<typeof NovoItemDoPlanejamento>;

export const EdicaoDeItemDoPlanejamento = NovoItemDoPlanejamento.omit({
  mes: true,
}).partial();
export type EdicaoDeItemDoPlanejamento = z.infer<typeof EdicaoDeItemDoPlanejamento>;

export const CopiaDoPlanejamento = z.object({ de: Mes, para: Mes });
export type CopiaDoPlanejamento = z.infer<typeof CopiaDoPlanejamento>;

export const ItemDoPlanejamento = z.object({
  id: Id,
  category_id: Id,
  descricao: z.string().nullable(),
  /** Valor fechado. */
  valor: Dinheiro,
  fixo: z.boolean(),
  recurrence_id: Id.nullable(),
  /** Percentual do usuario quando dividido; null: nao dividido. */
  parte_propria: z.number().nullable(),
  /** Parte do usuario: o que entra no planejado da categoria. */
  valor_proprio: Dinheiro,
});
export type ItemDoPlanejamento = z.infer<typeof ItemDoPlanejamento>;

export const Planejamento = z.object({
  competencia: Data,
  itens: z.array(ItemDoPlanejamento),
  categorias: z.array(
    z.object({
      category_id: Id,
      nome: z.string(),
      natureza: z.enum(["receita", "despesa"]),
      planejado: Dinheiro,
      fixo: Dinheiro,
      realizado: Dinheiro,
      previsto: Dinheiro,
      restante: Dinheiro,
      /** Realizado + previsto. */
      consumo: Dinheiro,
      /** So para despesa: ok, atencao (>= 80%), estourado (> 100%). */
      estado: z.enum(["ok", "atencao", "estourado"]),
    }),
  ),
  totais: z.object({
    receitas_planejadas: Dinheiro,
    despesas_planejadas: Dinheiro,
    despesas_fixas: Dinheiro,
    despesas_variaveis: Dinheiro,
    sobra_planejada: Dinheiro,
    receitas_realizadas: Dinheiro,
    despesas_realizadas: Dinheiro,
    /** Parte das despesas divididas que outra pessoa cobre. */
    despesas_de_terceiros: Dinheiro,
  }),
});
export type Planejamento = z.infer<typeof Planejamento>;

export const ResultadoDeCopia = z.object({ itens: z.number().int() });
