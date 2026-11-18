/** Aplica as migrations do schema alerts. Passo unico antes do worker subir. */
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

const pasta = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");
const pool = criarPool({ url, maxConnections: 1 });
try {
  // Journal proprio: as migrations do alerts nao se misturam com as do
  // market-data, que usam o schema "drizzle".
  await migrate(drizzle(pool), {
    migrationsFolder: pasta,
    migrationsSchema: "drizzle_alerts",
  });
  process.stdout.write("migrations do alerts aplicadas\n");
} finally {
  await pool.end();
}
