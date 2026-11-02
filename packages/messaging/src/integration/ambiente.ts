import { resolve } from "node:path";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { criarDb, criarPool, type Db } from "@bolsiq/db-core";

/** Porta de host fixa para o NATS, para poder recriar o container no mesmo endereço. */
export const PORTA_NATS = 14_222;

/**
 * Host pelo qual o teste alcança os containers.
 *
 * No CI o teste roda direto no runner, então `127.0.0.1` serve. Rodando o
 * próprio teste dentro de um container (com o socket do Docker montado), os
 * containers irmãos ficam no host, não em `127.0.0.1` — daí o override.
 */
export const HOST_TESTE = process.env.TEST_HOST ?? "127.0.0.1";

export interface Ambiente {
  db: Db;
  pool: Pool;
  urlBanco: string;
  urlNats: string;
  postgres: StartedTestContainer;
  nats: StartedTestContainer;
}

export async function subirPostgres(): Promise<{
  container: StartedTestContainer;
  url: string;
}> {
  const container = await new GenericContainer("timescale/timescaledb-ha:pg17")
    .withEnvironment({
      POSTGRES_USER: "bolsiq",
      POSTGRES_PASSWORD: "bolsiq",
      POSTGRES_DB: "bolsiq_test",
    })
    .withExposedPorts(5432)
    .withStartupTimeout(120_000)
    .start();

  const url = `postgres://bolsiq:bolsiq@${HOST_TESTE}:${container.getMappedPort(5432)}/bolsiq_test`;
  return { container, url };
}

/**
 * Sobe o NATS numa porta de host fixa.
 *
 * Fixa de propósito: o teste do critério "derrubar o NATS e subir de novo"
 * precisa recriar o broker no mesmo endereço, para o cliente reconectar sozinho.
 */
export async function subirNats(): Promise<StartedTestContainer> {
  return new GenericContainer("nats:2-alpine")
    .withCommand(["-js", "-sd", "/data", "-m", "8222"])
    .withExposedPorts({ container: 4222, host: PORTA_NATS })
    .withStartupTimeout(60_000)
    .start();
}

export async function aplicarMigrations(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: resolve(import.meta.dirname, "../../../db-core/migrations"),
      migrationsSchema: "drizzle",
    });
  } finally {
    await pool.end();
  }
}

export function conectarBanco(url: string): { db: Db; pool: Pool } {
  const pool = criarPool({ url, maxConnections: 5 });
  return { db: criarDb(pool), pool };
}

export async function esperar(
  condicao: () => Promise<boolean>,
  ms = 20_000,
): Promise<void> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await condicao()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`condição não satisfeita em ${ms}ms`);
}
