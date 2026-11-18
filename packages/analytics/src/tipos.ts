import { z } from "zod";
import { IsoDate, Money } from "@bolsiq/contracts";

/**
 * Entradas vindas das demonstracoes financeiras, ja normalizadas pela
 * ESCALA_MOEDA da CVM. Valores em reais, como string decimal.
 */
export const Demonstrativo = z.object({
  reference_date: IsoDate,
  receita: Money,
  resultado_bruto: Money,
  /** 3.05 na CVM: resultado antes do financeiro e dos tributos. */
  ebit: Money,
  lucro_liquido: Money,
  /** Depreciacao, amortizacao e exaustao, do fluxo de caixa. */
  depreciacao_amortizacao: Money,
  ativo_total: Money,
  ativo_circulante: Money,
  caixa_equivalentes: Money,
  passivo_circulante: Money,
  patrimonio_liquido: Money,
  divida_bruta: Money,
});
export type Demonstrativo = z.infer<typeof Demonstrativo>;

export const DadosDeMercado = z.object({
  preco: Money,
  /** Acoes em circulacao, ja descontada a tesouraria. */
  acoes: z.number().int().positive(),
  /** Proventos por acao nos ultimos 12 meses. */
  proventos_12m: Money.optional(),
  /** Proventos por acao por ano, do mais antigo ao mais recente. */
  proventos_por_ano: z.array(Money).optional(),
});
export type DadosDeMercado = z.infer<typeof DadosDeMercado>;

export const SerieDeRetornos = z.object({
  /** Retornos diarios simples, em fracao (0.012 = 1,2%). */
  ativo: z.array(z.number()),
  /** Retorno diario do CDI, mesma janela. Usado no Sharpe. */
  cdi: z.array(z.number()).optional(),
  /** Retorno diario do IBOV, mesma janela. Usado no beta. */
  ibov: z.array(z.number()).optional(),
});
export type SerieDeRetornos = z.infer<typeof SerieDeRetornos>;
