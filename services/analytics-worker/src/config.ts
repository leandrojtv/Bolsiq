import { z } from "zod";

export const Env = z.object({
  DATABASE_URL: z.string().url(),
  NATS_URL: z.string().default("nats://localhost:4222"),
  /** Base do /v1. O analytics le dado de mercado pela API, nunca pelo banco. */
  MARKET_DATA_URL: z.string().url().default("http://localhost:3001"),
  PORT: z.coerce.number().int().positive().default(3003),
  RECALC_CONCURRENCY: z.coerce.number().int().positive().max(32).default(4),
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
