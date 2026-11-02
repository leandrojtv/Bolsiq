import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

export type Db = ReturnType<typeof criarDb>;

export interface DbOptions {
  url: string;
  maxConnections?: number;
}

export function criarPool(options: DbOptions): Pool {
  return new Pool({
    connectionString: options.url,
    max: options.maxConnections ?? 10,
    // Em `numeric` o driver devolveria number por padrão; forçar string
    // preserva a precisão até a borda da aplicação.
    application_name: "bolsiq-market-data",
  });
}

export function criarDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export { schema };
