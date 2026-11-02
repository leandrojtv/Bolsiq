import { z } from "zod";
import { Money, Ticker } from "@bolsiq/contracts";

export const Canal = z.enum(["inapp", "email", "push", "telegram"]);
export type Canal = z.infer<typeof Canal>;

const base = {
  id: z.string().min(1),
  user_id: z.string().min(1),
  canais: z.array(Canal).min(1),
  cooldown_segundos: z.number().int().nonnegative().default(3600),
  ativo: z.boolean().default(true),
  armado: z.boolean().default(true),
  ultimo_disparo_em: z.string().nullable().default(null),
};

export const Regra = z.discriminatedUnion("tipo", [
  z.object({
    ...base,
    tipo: z.literal("preco_acima"),
    ticker: Ticker,
    params: z.object({ valor: Money }),
  }),
  z.object({
    ...base,
    tipo: z.literal("preco_abaixo"),
    ticker: Ticker,
    params: z.object({ valor: Money }),
  }),
  z.object({
    ...base,
    tipo: z.literal("variacao_diaria"),
    ticker: Ticker,
    /** Variacao absoluta em fracao: 0.05 dispara em +5% ou -5%. */
    params: z.object({ percentual: z.number().positive() }),
  }),
  z.object({
    ...base,
    tipo: z.literal("abaixo_graham"),
    ticker: Ticker,
    params: z.object({}).default({}),
  }),
  z.object({
    ...base,
    tipo: z.literal("abaixo_bazin"),
    ticker: Ticker,
    params: z.object({}).default({}),
  }),
  z.object({
    ...base,
    tipo: z.literal("dy_acima"),
    ticker: Ticker,
    params: z.object({ percentual: z.number().positive() }),
  }),
  z.object({
    ...base,
    tipo: z.literal("provento_anunciado"),
    ticker: Ticker,
    params: z.object({}).default({}),
  }),
  z.object({
    ...base,
    tipo: z.literal("data_com_proxima"),
    ticker: Ticker,
    /** Avisa quando a data com estiver a ate N dias. */
    params: z.object({ dias: z.number().int().positive().max(60) }),
  }),
  z.object({
    ...base,
    tipo: z.literal("demonstrativo_publicado"),
    ticker: Ticker,
    params: z.object({}).default({}),
  }),
]);
export type Regra = z.infer<typeof Regra>;
export type TipoDeRegra = Regra["tipo"];

/** Qual evento alimenta cada tipo de regra. E a base do indice. */
export const EVENTO_DO_TIPO: Record<TipoDeRegra, string> = {
  preco_acima: "marketdata.quote.updated.v1",
  preco_abaixo: "marketdata.quote.updated.v1",
  variacao_diaria: "marketdata.quote.updated.v1",
  abaixo_graham: "analytics.indicators.updated.v1",
  abaixo_bazin: "analytics.indicators.updated.v1",
  dy_acima: "analytics.indicators.updated.v1",
  provento_anunciado: "marketdata.dividend.announced.v1",
  data_com_proxima: "marketdata.dividend.announced.v1",
  demonstrativo_publicado: "marketdata.statement.published.v1",
};
