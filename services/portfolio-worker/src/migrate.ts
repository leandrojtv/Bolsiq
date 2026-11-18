/**
 * Migrations dos schemas do app que nao tem processo proprio: `portfolio`,
 * `assistant` e `app` (Better Auth e watchlist). Passo unico antes do web e do worker.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { criarPool } from "@bolsiq/db-core";

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write("DATABASE_URL nao definida\n");
  process.exit(1);
}

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");
const pool = criarPool({ url, maxConnections: 1 });
try {
  // Um journal por schema, como alerts e analytics.
  for (const [pasta, journal] of [
    ["app", "drizzle_app"],
    ["portfolio", "drizzle_portfolio"],
    ["assistant", "drizzle_assistant"],
  ] as const) {
    await migrate(drizzle(pool), {
      migrationsFolder: resolve(raiz, pasta),
      migrationsSchema: journal,
    });
    process.stdout.write(`migrations de ${pasta} aplicadas\n`);
  }
} finally {
  await pool.end();
}
