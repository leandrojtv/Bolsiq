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
export const Env = z.object({
  ROLE: Role.default("all"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3001),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  SERVICE_VERSION: z.string().default("0.0.0"),
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
