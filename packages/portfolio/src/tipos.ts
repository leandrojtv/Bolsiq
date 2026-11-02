import { z } from "zod";
import { IsoDate, Money, Ticker } from "@bolsiq/contracts";

/**
 * Tipos de transacao.
 *
 * `desdobramento` e `grupamento` chegam de `marketdata.dividend.announced.v1`
 * e nao tem preco: alteram quantidade e preco medio sem fluxo de caixa.
 */
export const TipoDeTransacao = z.enum([
  "compra",
  "venda",
  "provento",
  "desdobramento",
  "grupamento",
  "bonificacao",
]);
export type TipoDeTransacao = z.infer<typeof TipoDeTransacao>;

export const Quantidade = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "quantidade deve ser string decimal nao negativa");

export const Transacao = z.object({
  id: z.string().min(1),
  ticker: Ticker,
  tipo: TipoDeTransacao,
  data: IsoDate,
  quantidade: Quantidade,
  /** Preco unitario. "0" em desdobramento e grupamento. */
  preco: Money,
  taxas: Money.default("0"),
  corretora: z.string().optional(),
});
export type Transacao = z.infer<typeof Transacao>;

export const ValorDeMercado = z.object({
  ticker: Ticker,
  data: IsoDate,
  preco: Money,
});
export type ValorDeMercado = z.infer<typeof ValorDeMercado>;
