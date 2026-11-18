import { z } from "zod";

/**
 * `ROLE` decide o que este processo executa (ADR 0006).
 *
 * - `api`    só serve HTTP
 * - `worker` só consome a fila do pg-boss
 * - `all`    os dois, para desenvolvimento num processo só
 */
export const Role = z.enum(["api", "worker", "all"]);
export type Role = z.infer<typeof Role>;

/**
 * Esquema de ambiente.
 *
 * Validar na inicialização e **falhar alto** é deliberado: o ADR 0006 registra
 * que um `ROLE` digitado errado em produção subiria dois `api` e nenhum
 * `worker`, e nada pareceria errado até o primeiro job agendado não rodar.
 */
/** Variável definida e vazia (`BRAPI_TOKEN=` no .env) vale como ausente. */
const vazioComoAusente = (v: unknown) => (v === "" ? undefined : v);

export const Env = z.object({
  ROLE: Role.default("all"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3001),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().url(),
  NATS_URL: z.string().default("nats://localhost:4222"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  SERVICE_VERSION: z.string().default("0.0.0"),
  /** Sem token, a brapi só serve os tickers de demonstração. */
  BRAPI_TOKEN: z.preprocess(vazioComoAusente, z.string().optional()),
  BRAPI_DELAY_MINUTES: z.coerce.number().int().nonnegative().default(15),
  QUOTE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  /** Token das rotas /admin. Sem ele, /admin recusa tudo. */
  ADMIN_TOKEN: z.preprocess(vazioComoAusente, z.string().min(16).optional()),
});

export type Env = z.infer<typeof Env>;

export function carregarEnv(fonte: NodeJS.ProcessEnv = process.env): Env {
  const resultado = Env.safeParse(fonte);

  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((i) => `  ${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("\n");
    throw new Error(`configuração de ambiente inválida:\n${problemas}`);
  }

  return resultado.data;
}

/**
 * A API pública de dados só é servida por `api` e `all`.
 */
export function servirApiPublica(role: Role): boolean {
  return role === "api" || role === "all";
}

/**
 * O endpoint de health é servido por **todos** os papéis, inclusive `worker`.
 *
 * Health é observabilidade, não API: um worker que não se pode checar é um
 * ponto cego para o orquestrador. Sem isto, `docker compose up --wait` declara
 * o worker unhealthy e o deploy falha sem que nada esteja errado.
 */
export function servirHealth(_role: Role): boolean {
  return true;
}

export function consumirFila(role: Role): boolean {
  return role === "worker" || role === "all";
}
