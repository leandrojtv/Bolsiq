import { z } from "zod";
import { valorDigitado } from "../decimal.js";
import { ACOES_DE_FEEDBACK, SEVERIDADES, TIPOS_DE_INSIGHT } from "./tipos.js";

/** Schemas do BFF de insights (ADR 0035). */

const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida");
const Mes = z.string().regex(/^\d{4}-\d{2}$/, "mês inválido");
const Dinheiro = z.string().regex(/^-?\d+\.\d{2}$/);

export const ParametroDoInsight = z.object({
  id: z.string().regex(/^[a-z_]+-[0-9a-z]{1,13}$/, "insight inválido"),
});
export const ParametroDeInsights = z.object({ mes: Mes.optional() });

const Feedback = z.object({ acao: z.enum(ACOES_DE_FEEDBACK), registrado_em: Data });

export const InsightDoBff = z.object({
  id: z.string(),
  tipo: z.enum(TIPOS_DE_INSIGHT),
  titulo: z.string(),
  descricao: z.string(),
  impacto_mensal: Dinheiro,
  impacto_anual: Dinheiro,
  severidade: z.enum(SEVERIDADES),
  evidencias: z.array(z.string()),
  acao_sugerida: z.string(),
  periodo: z.object({ inicio: Data, fim: Data }),
  dados: z.record(z.unknown()),
  feedback: Feedback.nullable(),
});
export type InsightDoBff = z.infer<typeof InsightDoBff>;

export const TaxaCdiDoBff = z.object({
  diaria: z.string(),
  data: Data,
  fonte: z.string(),
});

const Referencia = z
  .object({
    essenciais: z.coerce.number().int().min(0).max(100),
    nao_essenciais: z.coerce.number().int().min(0).max(100),
    poupanca: z.coerce.number().int().min(0).max(100),
  })
  .refine((r) => r.essenciais + r.nao_essenciais + r.poupanca === 100, {
    message: "a referência soma 100%",
  });

export const ConfiguracaoDeInsights = z.object({
  limite_formiga: z.string().transform((v, ctx) => {
    const n = valorDigitado(v);
    if (n === null || Number(n) <= 0 || Number(n) > 1000) {
      ctx.addIssue({ code: "custom", message: "limite entre R$ 0,01 e R$ 1.000" });
      return z.NEVER;
    }
    return Number(n).toFixed(2);
  }),
  referencia: Referencia,
});
export type ConfiguracaoDeInsights = z.infer<typeof ConfiguracaoDeInsights>;

export const ListaDeInsights = z.object({
  periodo: Mes,
  calculado_em: z.string(),
  insights: z.array(InsightDoBff),
  /** Dispensados que nao aparecem agora. */
  ocultos: z.number().int(),
  cdi: TaxaCdiDoBff.nullable(),
  configuracao: z.object({
    limite_formiga: Dinheiro,
    referencia: z.object({
      essenciais: z.number(),
      nao_essenciais: z.number(),
      poupanca: z.number(),
    }),
  }),
});
export type ListaDeInsights = z.infer<typeof ListaDeInsights>;

export const EvidenciaDoInsight = z.object({
  id: z.string(),
  data: Data,
  descricao: z.string(),
  valor: Dinheiro,
  tipo: z.enum(["receita", "despesa", "transferencia"]),
  categoria: z.string().nullable(),
  origem: z.string().nullable(),
});
export type EvidenciaDoInsight = z.infer<typeof EvidenciaDoInsight>;

export const DetalheDoInsight = z.object({
  insight: InsightDoBff,
  evidencias: z.array(EvidenciaDoInsight),
});
export type DetalheDoInsight = z.infer<typeof DetalheDoInsight>;

export const PedidoDeFeedback = z.object({ acao: z.enum(ACOES_DE_FEEDBACK) });
export type PedidoDeFeedback = z.infer<typeof PedidoDeFeedback>;

export const RespostaDeFeedback = z.object({
  insight_id: z.string(),
  acao: z.enum(ACOES_DE_FEEDBACK),
  registrado_em: Data,
});

export const AssinaturaDoBff = z.object({
  id: z.string(),
  nome: z.string(),
  frequencia: z.enum(["mensal", "anual"]),
  valor_atual: Dinheiro,
  valor_mensal: Dinheiro,
  valor_anual: Dinheiro,
  ocorrencias: z.number().int(),
  primeira: Data,
  ultima: Data,
  proxima: Data,
  categoria: z.string().nullable(),
  grupo: z.string().nullable(),
  reajuste: z.object({ de: Dinheiro, para: Dinheiro, percentual: z.number() }).nullable(),
  duplicidade: z.array(z.string()),
  nova: z.boolean(),
  feedback: Feedback.nullable(),
});
export type AssinaturaDoBff = z.infer<typeof AssinaturaDoBff>;

export const ListaDeAssinaturas = z.object({
  assinaturas: z.array(AssinaturaDoBff),
  total_mensal: Dinheiro,
  total_anual: Dinheiro,
  cdi: TaxaCdiDoBff.nullable(),
});
export type ListaDeAssinaturas = z.infer<typeof ListaDeAssinaturas>;

const MesDoFluxo = z.object({
  mes: Mes,
  entradas: Dinheiro,
  saidas: Dinheiro,
  saldo_final: Dinheiro,
});

export const BaseDoSimuladorDoBff = z.object({
  assinaturas: z.array(
    z.object({ id: z.string(), nome: z.string(), valor_mensal: Dinheiro }),
  ),
  categorias: z.array(
    z.object({ category_id: z.string(), nome: z.string(), media_mensal: Dinheiro }),
  ),
  formiga: z.object({ mensal: Dinheiro }).nullable(),
  fluxo: z.object({
    saldo_inicial: Dinheiro,
    meses: z.array(MesDoFluxo),
    primeiro_mes_negativo: Mes.nullable(),
  }),
  metas: z.array(
    z.object({
      id: z.string(),
      nome: z.string(),
      falta: Dinheiro,
      valor_mensal_necessario: Dinheiro,
    }),
  ),
  cdi: TaxaCdiDoBff.nullable(),
});

export const RecorrenciaDaAssinatura = z.object({ recurrence_id: z.string() });
