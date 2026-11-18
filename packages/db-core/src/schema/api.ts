import {
  bigint,
  boolean,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  pgSchema,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Declarado aqui, e não importado de ./market.ts, de propósito: o drizzle-kit
// carrega os arquivos de schema em CJS e não resolve o sufixo `.js` que o
// NodeNext exige num import relativo. `pgSchema` é apenas um nome, então
// declarar nos dois arquivos é equivalente.
const marketData = pgSchema("market_data");

const utc = (nome: string) => timestamp(nome, { withTimezone: true, mode: "string" });

/**
 * Planos da API pública.
 *
 * `allowedEndpoints` guarda os prefixos de rota liberados. Fundamentals só a
 * partir de `startup`, conforme docs/api/guia-do-cliente.md.
 */
export const apiPlans = marketData.table("api_plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  requestsPerMinute: integer("requests_per_minute").notNull(),
  requestsPerMonth: bigint("requests_per_month", { mode: "number" }).notNull(),
  tickersPerCall: integer("tickers_per_call").notNull(),
  allowedEndpoints: text("allowed_endpoints").array().notNull(),
  /** `true` no plano interno usado pelo apps/web; não entra nas métricas de venda. */
  isInternal: boolean("is_internal").notNull().default(false),
  createdAt: utc("created_at").notNull().defaultNow(),
});

export const apiClients = marketData.table(
  "api_clients",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    planId: text("plan_id")
      .notNull()
      .references(() => apiPlans.id),
    status: text("status").notNull().default("active"),
    createdAt: utc("created_at").notNull().defaultNow(),
  },
  (t) => [index("api_clients_plan_idx").on(t.planId)],
);

/**
 * Chaves de API.
 *
 * **Nunca guardar a chave.** Só o hash e o prefixo visível. O prefixo
 * `mdk_live_xxxxxx` serve para o cliente reconhecer a chave e para varredores
 * de segredo detectarem vazamento em repositório público.
 */
export const apiKeys = marketData.table(
  "api_keys",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => apiClients.id),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: utc("created_at").notNull().defaultNow(),
    /** Atualizado de forma assíncrona: escrever a cada requisição custa caro. */
    lastUsedAt: utc("last_used_at"),
    revokedAt: utc("revoked_at"),
  },
  (t) => [
    uniqueIndex("api_keys_hash_uq").on(t.keyHash),
    index("api_keys_prefix_idx").on(t.keyPrefix),
    index("api_keys_client_idx").on(t.clientId),
    index("api_keys_status_idx").on(t.status),
  ],
);

/** Uso da API — hypertable, com agregado diário por chave. */
export const apiUsage = marketData.table(
  "api_usage",
  {
    keyId: text("key_id").notNull(),
    ts: utc("ts").notNull(),
    route: text("route").notNull(),
    method: text("method").notNull(),
    status: integer("status").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    correlationId: text("correlation_id"),
  },
  (t) => [
    primaryKey({ columns: [t.keyId, t.ts, t.route] }),
    index("api_usage_ts_idx").on(t.ts),
  ],
);
