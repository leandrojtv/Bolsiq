import { z } from "zod";

/**
 * Valor monetário.
 *
 * Regra 5 do CLAUDE.md: moeda em `numeric`, nunca `float`. No contrato isso
 * aparece como **string decimal**, não number — serializar `numeric` como
 * number JavaScript reintroduz o erro de ponto flutuante que o `numeric`
 * existe para evitar. `0.1 + 0.2 !== 0.3` não é aceitável em preço de ativo.
 *
 * O cliente recebe `"38.42"` e decide com que biblioteca decimal trabalhar.
 */
export const Money = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "valor monetário deve ser uma string decimal");

/** Quantidade inteira não negativa (volume, negócios, cotistas). */
export const Count = z.number().int().nonnegative();

/**
 * Data-only, `YYYY-MM-DD`.
 *
 * Usada para dia de pregão e data de competência, onde hora não existe e
 * incluí-la só cria ambiguidade de fuso.
 */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "data deve estar em YYYY-MM-DD");

/**
 * Instante em UTC.
 *
 * Regra 5: `timestamptz` em UTC no banco; exibição em America/Sao_Paulo é
 * responsabilidade da camada de apresentação, nunca do contrato.
 */
export const IsoDateTime = z.string().datetime({ offset: true });

/** CNPJ com 14 dígitos, já normalizado (sem pontuação). */
export const Cnpj = z
  .string()
  .regex(/^\d{14}$/, "CNPJ deve ter 14 dígitos, sem pontuação");

/** Ticker da B3, como aparece no COTAHIST. */
export const Ticker = z
  .string()
  .regex(/^[A-Z0-9]{4,12}$/, "ticker deve ter 4 a 12 caracteres maiúsculos");

/** ISIN de 12 caracteres. */
export const Isin = z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/, "ISIN inválido");

/**
 * Proveniência obrigatória em todo dado de mercado (regra 4 do CLAUDE.md).
 *
 * `license` não é enfeite: ela diz ao cliente o que ele pode fazer com o dado.
 * Preço da B3 é proprietário e não redistribuível; dado da CVM é ODbL. Ver
 * docs/services/market-data-sources.md.
 */
export const Provenance = z.object({
  source: z.string().min(1),
  fetched_at: IsoDateTime,
  license: z.string().min(1),
  source_ref: z.string().min(1),
});

export type Money = z.infer<typeof Money>;
export type Provenance = z.infer<typeof Provenance>;
