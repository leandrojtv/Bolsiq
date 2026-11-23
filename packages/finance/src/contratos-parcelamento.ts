import { z } from "zod";
import { valorDigitado } from "./decimal.js";

/** Schemas de parcelamentos, dividas, metas, fluxo e orcamento. */

const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida");
const Id = z.string().min(1).max(64);
const Dinheiro = z.string().regex(/^-?\d+\.\d{2}$/);
const Mes = z.string().regex(/^\d{4}-\d{2}$/, "mês inválido");
const vazioNulo = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const valor = (minimo: "positivo" | "zero") =>
  z.string().transform((v, ctx) => {
    const n = valorDigitado(v);
    if (n === null || (minimo === "positivo" ? Number(n) <= 0 : Number(n) < 0)) {
      ctx.addIssue({ code: "custom", message: "valor inválido" });
      return z.NEVER;
    }
    return n;
  });
/** Taxa digitada em % ao mes ("1,5") vira fracao ("0.015"). */
const TaxaPercentual = z.string().transform((v, ctx) => {
  const t = v.trim().replace(",", ".").replace("%", "");
  if (!/^\d+(\.\d+)?$/.test(t) || Number(t) > 100) {
    ctx.addIssue({ code: "custom", message: "taxa inválida" });
    return z.NEVER;
  }
  return String(Number(t) / 100);
});
const Parcelas = z.coerce.number().int().min(2, "pelo menos 2 parcelas").max(600);

export const NovoParcelamentoNoCartao = z
  .object({
    card_id: Id,
    descricao: z.string().trim().min(1, "informe a descrição").max(200),
    category_id: z.preprocess(vazioNulo, Id.nullable().optional()),
    data: Data,
    n_parcelas: Parcelas,
    /** Um dos dois: o valor de cada parcela ou o total. */
    valor_parcela: valor("positivo").optional(),
    valor_total: valor("positivo").optional(),
  })
  .refine((p) => !p.valor_parcela !== !p.valor_total, {
    message: "informe o valor da parcela ou o total",
    path: ["valor_parcela"],
  });
export type NovoParcelamentoNoCartao = z.infer<typeof NovoParcelamentoNoCartao>;

export const NovoEmprestimo = z.object({
  origem: z.enum(["emprestimo", "financiamento"]),
  account_id: Id,
  descricao: z.string().trim().min(1, "informe a descrição").max(200),
  category_id: z.preprocess(vazioNulo, Id.nullable().optional()),
  valor_financiado: valor("positivo"),
  /** % ao mes. */
  taxa_mensal: TaxaPercentual,
  n_parcelas: Parcelas,
  sistema: z.enum(["price", "sac"]),
  /** Vencimento da primeira parcela. */
  primeira_data: Data,
});
export type NovoEmprestimo = z.infer<typeof NovoEmprestimo>;
export type EmprestimoDigitado = z.input<typeof NovoEmprestimo>;

export const PedidoDeAmortizacao = z.object({
  extra: valor("positivo"),
  modo: z.enum(["reduzir_prazo", "reduzir_parcela"]),
  data: Data,
});
export type PedidoDeAmortizacao = z.infer<typeof PedidoDeAmortizacao>;

export const PedidoDeSimulacao = PedidoDeAmortizacao.omit({ data: true });
export const PedidoDeQuitacao = z.object({ data: Data });

const Linha = z.object({
  numero: z.number().int(),
  data: Data,
  parcela: Dinheiro,
  juros: Dinheiro,
  amortizacao: Dinheiro,
  saldo: Dinheiro,
  status: z.enum(["previsto", "realizado", "conciliado"]),
});

export const Plano = z.object({
  id: Id,
  origem: z.enum(["cartao", "emprestimo", "financiamento"]),
  descricao: z.string(),
  category_id: Id.nullable(),
  card_id: Id.nullable(),
  account_id: Id.nullable(),
  valor_total: Dinheiro,
  valor_financiado: Dinheiro,
  n_parcelas: z.number().int(),
  sistema: z.enum(["sem_juros", "price", "sac"]),
  taxa_mensal: z.string(),
  primeira_data: Data,
  ativo: z.boolean(),
  parcelas_pagas: z.number().int(),
  parcelas_restantes: z.number().int(),
  /** Soma das parcelas previstas. */
  valor_restante: Dinheiro,
  /** Emprestimo: principal ainda devido. Cartao: igual ao restante. */
  saldo_devedor: Dinheiro,
  proxima: z.object({ numero: z.number().int(), data: Data, valor: Dinheiro }).nullable(),
});
export type Plano = z.infer<typeof Plano>;

export const DetalheDoPlano = Plano.extend({ tabela: z.array(Linha) });
export type DetalheDoPlano = z.infer<typeof DetalheDoPlano>;

/**
 * Excluir um plano: as parcelas previstas somem; os lancamentos ja realizados
 * (parcelas pagas e amortizacoes extras) ficam, soltos do plano (ADR 0039).
 */
export const ResultadoDaExclusao = z.object({
  previstas_apagadas: z.number().int().min(0),
  realizados_desvinculados: z.number().int().min(0),
});
export type ResultadoDaExclusao = z.infer<typeof ResultadoDaExclusao>;

export const ResultadoDaSimulacao = z.object({
  antes: z.object({
    parcelas: z.number().int(),
    primeira_parcela: Dinheiro,
    juros: Dinheiro,
  }),
  depois: z.object({
    parcelas: z.number().int(),
    primeira_parcela: Dinheiro,
    juros: Dinheiro,
  }),
  juros_economizados: Dinheiro,
  tabela: z.array(
    z.object({
      numero: z.number().int(),
      parcela: Dinheiro,
      juros: Dinheiro,
      amortizacao: Dinheiro,
      saldo: Dinheiro,
    }),
  ),
});

export const Comprometido = z.array(
  z.object({
    mes: Mes,
    total: Dinheiro,
    por_plano: z.array(
      z.object({ plano_id: Id, descricao: z.string(), valor: Dinheiro }),
    ),
  }),
);
export type Comprometido = z.infer<typeof Comprometido>;

// Metas

export const NovaMeta = z.object({
  nome: z.string().trim().min(1, "informe o nome").max(80),
  valor_alvo: valor("positivo"),
  data_alvo: Data,
  account_id: z.preprocess(vazioNulo, Id.nullable().optional()),
  portfolio_id: z.preprocess(vazioNulo, Id.nullable().optional()),
  valor_guardado: valor("zero").optional(),
  ativa: z.boolean().default(true),
});
export type NovaMeta = z.infer<typeof NovaMeta>;
export type MetaDigitada = z.input<typeof NovaMeta>;
export const EdicaoDeMeta = NovaMeta.partial();
export type EdicaoDeMeta = z.infer<typeof EdicaoDeMeta>;

export const Meta = z.object({
  id: Id,
  nome: z.string(),
  valor_alvo: Dinheiro,
  data_alvo: Data,
  account_id: Id.nullable(),
  portfolio_id: Id.nullable(),
  valor_guardado: Dinheiro,
  ativa: z.boolean(),
  /** conta | carteira | manual */
  fonte: z.enum(["conta", "carteira", "manual"]),
  valor_atual: Dinheiro,
  progresso: z.number(),
  meses_restantes: z.number().int(),
  /** Quanto guardar por mes para chegar na data. */
  valor_mensal_necessario: Dinheiro,
});
export type Meta = z.infer<typeof Meta>;

// Fluxo e orcamento

export const ParametroDoFluxo = z.object({
  meses: z.coerce
    .number()
    .int()
    .min(3, "de 3 a 12 meses")
    .max(12, "de 3 a 12 meses")
    .default(6),
});

export const FluxoDeCaixa = z.object({
  saldo_inicial: Dinheiro,
  meses: z.array(
    z.object({ mes: Mes, entradas: Dinheiro, saidas: Dinheiro, saldo_final: Dinheiro }),
  ),
  primeiro_mes_negativo: Mes.nullable(),
});
export type FluxoDeCaixa = z.infer<typeof FluxoDeCaixa>;

export const ValorDaCategoria = z.object({
  mes: Mes,
  category_id: Id,
  valor: valor("zero"),
});
export type ValorDaCategoria = z.infer<typeof ValorDaCategoria>;
