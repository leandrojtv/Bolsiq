/**
 * Aplica as migrations. Executado como passo único antes de qualquer serviço
 * subir — ver .github/workflows/deploy.yml.
 */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { criarDb, criarPool } from "./client.js";

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write("DATABASE_URL não definida.\n");
  process.exit(1);
}

const aqui = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(aqui, "../migrations");

const pool = criarPool({ url, maxConnections: 1 });

try {
  await migrate(criarDb(pool), { migrationsFolder, migrationsSchema: "drizzle" });
  process.stdout.write("migrations aplicadas\n");
} catch (erro) {
  process.stderr.write(`falha ao aplicar migrations: ${String(erro)}\n`);
  process.exit(1);
} finally {
  await pool.end();
}
