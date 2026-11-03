import { z } from "zod";

export const Env = z.object({
  DATABASE_URL: z.string().url(),
  /** Base do /v1. O portfolio le preco pela API, nunca pelo banco do market-data. */
  MARKET_DATA_URL: z.string().url().default("http://localhost:3001"),
  MARKET_DATA_API_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().optional(),
  ),
  PORT: z.coerce.number().int().positive().default(3004),
  /** Snapshot do fechamento: dias uteis, 19h de Brasilia. */
  SNAPSHOT_CRON: z.string().default("0 19 * * 1-5"),
  /** De quanto em quanto tempo procura carteira marcada para recalcular. */
  RECALCULO_MS: z.coerce.number().int().positive().default(2000),
});
export type Env = z.infer<typeof Env>;

export function carregarEnv(fonte: NodeJS.ProcessEnv = process.env): Env {
  const r = Env.safeParse(fonte);
  if (!r.success) {
    throw new Error(
      `configuracao invalida:\n${r.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`,
    );
  }
  return r.data;
}
