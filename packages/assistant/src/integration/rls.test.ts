import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { Pool, type PoolClient } from "pg";

const HOST = process.env.TEST_HOST ?? "127.0.0.1";

let container: StartedTestContainer;
let dono: Pool;

/** Como o `comoUsuario`: papel sem BYPASSRLS e usuario na transacao. */
async function como<T>(uid: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await dono.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE bolsiq_app");
    await c.query("SELECT set_config('bolsiq.user_id', $1, true)", [uid]);
    return await fn(c);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

beforeAll(async () => {
  container = await new GenericContainer("timescale/timescaledb-ha:pg17")
    .withEnvironment({
      POSTGRES_USER: "dono",
      POSTGRES_PASSWORD: "dono",
      POSTGRES_DB: "ci",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forSuccessfulCommand("pg_isready -h 127.0.0.1 -p 5432"))
    .withStartupTimeout(120_000)
    .start();
  dono = new Pool({
    connectionString: `postgres://dono:dono@${HOST}:${container.getMappedPort(5432)}/ci`,
    max: 3,
  });
  const pasta = resolve(import.meta.dirname, "../../migrations");
  for (const arquivo of readdirSync(pasta)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    for (const bloco of readFileSync(resolve(pasta, arquivo), "utf8").split(
      "--> statement-breakpoint",
    )) {
      if (bloco.trim()) await dono.query(bloco);
    }
  }
  // FORCE vale para o dono, entao a semente tambem entra como usuario.
  for (const uid of ["a", "b"]) {
    const c = await dono.connect();
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE bolsiq_app");
    await c.query("SELECT set_config('bolsiq.user_id', $1, true)", [uid]);
    await c.query(
      "INSERT INTO assistant.settings (user_id, provedor, chave_cifrada) VALUES ($1, 'deepseek', 'v1.x')",
      [uid],
    );
    await c.query(
      "INSERT INTO assistant.investor_profiles (user_id, perfil) VALUES ($1, '{}')",
      [uid],
    );
    await c.query("COMMIT");
    c.release();
  }
});

afterAll(async () => {
  await dono?.end();
  await container?.stop();
});

const TABELAS = ["settings", "investor_profiles", "conversations", "messages", "usage"];

describe("RLS do schema assistant", () => {
  it("toda tabela tem RLS forcada", async () => {
    const r = await dono.query<{ relname: string; f: boolean; e: boolean }>(
      `select c.relname, c.relforcerowsecurity f, c.relrowsecurity e from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'assistant' and c.relkind = 'r'`,
    );
    expect(r.rows.map((x) => x.relname).sort()).toEqual([...TABELAS].sort());
    expect(r.rows.every((x) => x.e && x.f)).toBe(true);
  });

  it("usuario so le a propria linha", async () => {
    const linhas = await como("a", async (c) => {
      return (
        await c.query<{ user_id: string }>("select user_id from assistant.settings")
      ).rows;
    });
    expect(linhas).toEqual([{ user_id: "a" }]);
  });

  it("sem usuario na sessao nao ve nada", async () => {
    const n = await como("", async (c) => {
      return (await c.query("select 1 from assistant.settings")).rowCount;
    });
    expect(n).toBe(0);
  });

  it("nao altera nem apaga a linha de outro usuario", async () => {
    await como("a", async (c) => {
      const u = await c.query(
        "update assistant.settings set modelo = 'x' where user_id = 'b'",
      );
      expect(u.rowCount).toBe(0);
      const d = await c.query("delete from assistant.settings where user_id = 'b'");
      expect(d.rowCount).toBe(0);
    });
  });

  it("nao grava em nome de outro usuario", async () => {
    await expect(
      como("a", (c) =>
        c.query(
          "insert into assistant.investor_profiles (user_id, perfil) values ('c', '{}')",
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("consumo nao se apaga pela aplicacao", async () => {
    await expect(
      como("a", (c) => c.query("delete from assistant.usage where user_id = 'a'")),
    ).rejects.toThrow(/permission denied/);
  });
});
