import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { Pool } from "pg";

const HOST = process.env.TEST_HOST ?? "127.0.0.1";

let container: StartedTestContainer;
/** Conexao do dono das tabelas: aplica migrations. */
let dono: Pool;
/** Conexao do papel da aplicacao: sem BYPASSRLS, nao e dono. */
let app: Pool;

const USUARIO_A = "user-aaa";
const USUARIO_B = "user-bbb";
let carteiraB = "";

/** Roda uma consulta com o usuario da sessao definido, como a aplicacao faz. */
async function comoUsuario<T>(
  pool: Pool,
  userId: string | null,
  fn: (
    q: (
      sql: string,
      params?: unknown[],
    ) => Promise<{ rows: T[]; rowCount: number | null }>,
  ) => Promise<void>,
): Promise<void> {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    if (userId !== null) {
      // SET LOCAL, nao SET: com SET o usuario vazaria para a proxima
      // requisicao que pegasse a mesma conexao do pool.
      await cliente.query("SELECT set_config('bolsiq.user_id', $1, true)", [userId]);
    }
    try {
      await fn(async (sql, params) => {
        const r = await cliente.query(sql, params);
        return { rows: r.rows as T[], rowCount: r.rowCount };
      });
    } finally {
      // ROLLBACK mesmo quando a consulta falha: sem isto a conexao volta ao
      // pool com transacao abortada e o teste seguinte quebra com
      // "current transaction is aborted".
      await cliente.query("ROLLBACK");
    }
  } finally {
    cliente.release();
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
    // A imagem sobe um Postgres temporario para o init e reinicia: a porta
    // abre antes de o banco aceitar conexao ("the database system is
    // starting up"). O temporario so escuta no socket, entao o pg_isready
    // por TCP so passa no servidor definitivo.
    .withWaitStrategy(Wait.forSuccessfulCommand("pg_isready -h 127.0.0.1 -p 5432"))
    .withStartupTimeout(120_000)
    .start();

  const porta = container.getMappedPort(5432);
  dono = new Pool({
    connectionString: `postgres://dono:dono@${HOST}:${porta}/ci`,
    max: 2,
  });

  // Aplica as migrations na ordem, dividindo nos breakpoints do Drizzle.
  const pasta = resolve(import.meta.dirname, "../../migrations");
  const arquivos = readdirSync(pasta)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const arquivo of arquivos) {
    const sql = readFileSync(resolve(pasta, arquivo), "utf8");
    for (const bloco of sql.split("--> statement-breakpoint")) {
      const t = bloco.trim();
      if (t !== "") await dono.query(t);
    }
  }

  // O papel nasce NOLOGIN na migration, porque criar credencial e do ambiente,
  // nao do schema. Aqui o teste da a ele uma senha para poder conectar.
  await dono.query("ALTER ROLE bolsiq_app LOGIN PASSWORD 'app'");
  app = new Pool({
    connectionString: `postgres://bolsiq_app:app@${HOST}:${porta}/ci`,
    max: 2,
  });

  // Semeia uma carteira para cada usuario, cada uma na sua sessao.
  for (const [u, nome] of [
    [USUARIO_A, "Carteira do A"],
    [USUARIO_B, "Carteira do B"],
  ] as const) {
    const cliente = await app.connect();
    try {
      await cliente.query("BEGIN");
      await cliente.query("SELECT set_config('bolsiq.user_id', $1, true)", [u]);
      const r = await cliente.query(
        "INSERT INTO portfolio.portfolios (id, user_id, nome) VALUES ($1, $2, $3) RETURNING id",
        [`pf-${u}`, u, nome],
      );
      await cliente.query(
        "INSERT INTO portfolio.transactions (id, portfolio_id, user_id, ticker, tipo, data, quantidade, preco) VALUES ($1,$2,$3,'PETR4','compra','2024-01-15','100','35.00')",
        [`tx-${u}`, `pf-${u}`, u],
      );
      await cliente.query("COMMIT");
      if (u === USUARIO_B) carteiraB = String((r.rows[0] as { id: string }).id);
    } finally {
      cliente.release();
    }
  }
}, 180_000);

afterAll(async () => {
  await app?.end().catch(() => undefined);
  await dono?.end().catch(() => undefined);
  await container?.stop().catch(() => undefined);
});

describe("RLS do portfolio", () => {
  it("usuario le so a propria carteira", async () => {
    await comoUsuario<{ user_id: string }>(app, USUARIO_A, async (q) => {
      const r = await q("SELECT user_id FROM portfolio.portfolios");
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.user_id).toBe(USUARIO_A);
    });
  });

  it("filtrar explicitamente pelo outro usuario nao devolve nada", async () => {
    await comoUsuario(app, USUARIO_A, async (q) => {
      const r = await q("SELECT * FROM portfolio.portfolios WHERE user_id = $1", [
        USUARIO_B,
      ]);
      expect(r.rows).toHaveLength(0);
    });
  });

  it("forjar o id da carteira do outro nao devolve nada", async () => {
    await comoUsuario(app, USUARIO_A, async (q) => {
      const r = await q("SELECT * FROM portfolio.portfolios WHERE id = $1", [carteiraB]);
      expect(r.rows).toHaveLength(0);
    });
  });

  it("transacoes do outro usuario tambem ficam invisiveis", async () => {
    await comoUsuario(app, USUARIO_A, async (q) => {
      const r = await q("SELECT * FROM portfolio.transactions WHERE portfolio_id = $1", [
        carteiraB,
      ]);
      expect(r.rows).toHaveLength(0);
    });
  });

  it("UPDATE na carteira do outro nao afeta linha nenhuma", async () => {
    await comoUsuario(app, USUARIO_A, async (q) => {
      const r = await q(
        "UPDATE portfolio.portfolios SET nome = 'invadida' WHERE id = $1",
        [carteiraB],
      );
      expect(r.rowCount).toBe(0);
    });
  });

  it("DELETE na carteira do outro nao afeta linha nenhuma", async () => {
    await comoUsuario(app, USUARIO_A, async (q) => {
      const r = await q("DELETE FROM portfolio.portfolios WHERE id = $1", [carteiraB]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("inserir no nome do outro usuario e recusado pelo WITH CHECK", async () => {
    await expect(
      comoUsuario(app, USUARIO_A, async (q) => {
        await q(
          "INSERT INTO portfolio.portfolios (id, user_id, nome) VALUES ('pf-forjada', $1, 'forjada')",
          [USUARIO_B],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("sem usuario na sessao, nenhuma linha e visivel", async () => {
    await comoUsuario(app, null, async (q) => {
      const r = await q("SELECT * FROM portfolio.portfolios");
      expect(r.rows).toHaveLength(0);
    });
  });

  it("RLS esta habilitada E forcada em todas as tabelas do schema", async () => {
    // `relforcerowsecurity` e o que faz a politica valer para o DONO da
    // tabela. Sem ele, migration e aplicacao rodando com o mesmo usuario
    // deixariam a RLS ativa e sem efeito.
    const r = await dono.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'portfolio' AND c.relkind = 'r'
        ORDER BY c.relname`,
    );

    const tabelas = r.rows.filter((x) =>
      ["portfolios", "transactions", "snapshots", "imports", "audit_log"].includes(
        x.relname,
      ),
    );
    expect(tabelas).toHaveLength(5);
    for (const t of tabelas) {
      expect(t.relrowsecurity, t.relname).toBe(true);
      expect(t.relforcerowsecurity, t.relname).toBe(true);
    }
  });

  it("superusuario ignora a RLS, e e por isso que a aplicacao nao pode ser superusuario", async () => {
    // Descoberta deste teste: FORCE ROW LEVEL SECURITY nao alcanca
    // superusuario. O `dono` aqui e superuser e ve tudo, sem usuario na
    // sessao. A barreira so existe porque a aplicacao conecta com bolsiq_app.
    const ehSuper = await dono.query<{ rolsuper: boolean }>(
      "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
    );
    expect(ehSuper.rows[0]?.rolsuper).toBe(true);

    await comoUsuario(dono, null, async (q) => {
      const r = await q("SELECT * FROM portfolio.portfolios");
      expect(r.rows.length).toBeGreaterThan(0);
    });
  });

  it("auditoria e append-only: a aplicacao nao altera nem apaga", async () => {
    await comoUsuario(app, USUARIO_A, async (q) => {
      await q(
        "INSERT INTO portfolio.audit_log (id, user_id, acao) VALUES ('a1', $1, 'login')",
        [USUARIO_A],
      );
      const lido = await q("SELECT * FROM portfolio.audit_log");
      expect(lido.rows).toHaveLength(1);
    });

    await expect(
      comoUsuario(app, USUARIO_A, async (q) => {
        await q("UPDATE portfolio.audit_log SET acao = 'outra'");
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("o papel da aplicacao nao tem BYPASSRLS", async () => {
    const r = await dono.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'bolsiq_app'",
    );
    expect(r.rows[0]?.rolbypassrls).toBe(false);
    expect(r.rows[0]?.rolsuper).toBe(false);
  });
});
