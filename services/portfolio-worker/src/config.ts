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
  // Importacao com IA (ADR 0027): o worker usa a chave do usuario.
  ASSISTANT_MASTER_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().optional(),
  ),
  ASSISTANT_OLLAMA_URL: z.string().url().default("http://host.docker.internal:11434"),
  ASSISTANT_OLLAMA_HOSTS: z.string().default("host.docker.internal,ollama"),
  ASSISTANT_DEEPSEEK_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().url().optional(),
  ),
  ASSISTANT_IMPORT_DAILY: z.coerce.number().int().positive().default(20),
  ASSISTANT_IMPORT_TOLERANCE: z.coerce.number().min(0).max(0.1).default(0.005),
  ASSISTANT_IMPORT_MAX_MB: z.coerce.number().int().positive().default(50),
  ASSISTANT_IMPORT_MAX_PAGES: z.coerce.number().int().positive().default(500),
  ASSISTANT_IMPORT_MAX_FILES: z.coerce.number().int().positive().default(20),
  ASSISTANT_IMPORT_CONFIRM_USD: z.coerce.number().min(0).default(0.5),
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
