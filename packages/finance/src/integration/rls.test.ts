import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { comoUsuario } from "../db/sessao.js";
import {
  apagarCategoria,
  apagarLancamento,
  criarConta,
  criarLancamento,
  editarLancamento,
  listarCategorias,
  listarContas,
  listarLancamentos,
  resumoDoMes,
  semearCategorias,
} from "../db/operacoes.js";
import { CATEGORIAS_PADRAO } from "../categorias-padrao.js";
import { FiltroDeLancamentos, NovaConta, NovoLancamento } from "../contratos.js";
import { accounts, transactions } from "../db/schema.js";

const HOST = process.env.TEST_HOST ?? "127.0.0.1";
const HOJE = "2026-03-31";

let container: StartedTestContainer;
/** Dono das tabelas (superusuario): aplica migrations. */
let dono: Pool;
/** Papel da aplicacao: sem BYPASSRLS, nao e dono. */
let app: Pool;
let db: NodePgDatabase<Record<string, unknown>>;

const A = "user-aaa";
const B = "user-bbb";
let contaA = "";
let contaB = "";
let poupancaA = "";
let lancamentoB = "";
let categoriaB = "";

/** Consulta crua no papel da aplicacao, com o usuario da sessao, e ROLLBACK no fim. */
async function cru<T>(
  userId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: T[]; rowCount: number | null }> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    if (userId !== null)
      await c.query("SELECT set_config('bolsiq.user_id', $1, true)", [userId]);
    try {
      const r = await c.query(sql, params);
      return { rows: r.rows as T[], rowCount: r.rowCount };
    } finally {
      await c.query("ROLLBACK");
    }
  } finally {
    c.release();
  }
}

const conta = (nome: string, saldo = "1000") =>
  NovaConta.parse({
    nome,
    tipo: "corrente",
    saldo_inicial: saldo,
    data_saldo_inicial: "2026-03-01",
  });

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
  const porta = container.getMappedPort(5432);
  dono = new Pool({
    connectionString: `postgres://dono:dono@${HOST}:${porta}/ci`,
    max: 3,
  });

  const pasta = resolve(import.meta.dirname, "../../migrations");
  for (const arquivo of readdirSync(pasta)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    for (const bloco of readFileSync(resolve(pasta, arquivo), "utf8").split(
      "--> statement-breakpoint",
    )) {
      if (bloco.trim() !== "") await dono.query(bloco);
    }
  }
  await dono.query("ALTER ROLE bolsiq_app LOGIN PASSWORD 'app'");
  app = new Pool({
    connectionString: `postgres://bolsiq_app:app@${HOST}:${porta}/ci`,
    max: 2,
  });
  // Como o web: conecta como superusuario e troca o papel na transacao (ADR 0022).
  db = drizzle(dono);

  for (const u of [A, B]) await comoUsuario(db, u, (tx) => semearCategorias(tx, u));
  contaA = (
    await comoUsuario(db, A, (tx) => criarConta(tx, A, conta("Corrente A"), HOJE))
  ).id;
  poupancaA = (
    await comoUsuario(db, A, (tx) => criarConta(tx, A, conta("Poupança A", "0"), HOJE))
  ).id;
  contaB = (
    await comoUsuario(db, B, (tx) => criarConta(tx, B, conta("Corrente B"), HOJE))
  ).id;
  const categoriasB = await comoUsuario(db, B, (tx) => listarCategorias(tx, B));
  categoriaB = categoriasB.find((c) => c.nome === "Mercado")?.id ?? "";
  const [l] = await comoUsuario(db, B, (tx) =>
    criarLancamento(
      tx,
      B,
      NovoLancamento.parse({
        tipo: "despesa",
        valor: "80",
        data: "2026-03-10",
        descricao: "Mercado do B",
        account_id: contaB,
        category_id: categoriaB,
      }),
    ),
  );
  lancamentoB = l?.id ?? "";
}, 180_000);

afterAll(async () => {
  await app?.end().catch(() => undefined);
  await dono?.end().catch(() => undefined);
  await container?.stop().catch(() => undefined);
});

describe("RLS do finance", () => {
  it("RLS habilitada e forcada em todas as tabelas do schema", async () => {
    const r = await dono.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'finance' AND c.relkind = 'r' ORDER BY c.relname`,
    );
    expect(r.rows.map((t) => t.relname)).toEqual([
      "accounts",
      "audit_log",
      "budget_items",
      "cards",
      "categories",
      "categorization_rules",
      "dead_letter",
      "emitted_alerts",
      "goals",
      "import_rows",
      "imports",
      "insight_feedback",
      "insight_settings",
      "insights",
      "installment_plans",
      "net_worth_snapshots",
      "outbox",
      "recurrences",
      "statements",
      "transactions",
    ]);
    // A dead-letter e so do publicador (ADR 0037): sem RLS, mas tambem sem
    // grant para a aplicacao, conferido no teste de auditoria e outbox.
    for (const t of r.rows.filter((x) => x.relname !== "dead_letter")) {
      expect(t.relrowsecurity, t.relname).toBe(true);
      expect(t.relforcerowsecurity, t.relname).toBe(true);
    }
  });

  it("A nao le conta, categoria nem lancamento do B", async () => {
    for (const tabela of ["accounts", "categories", "transactions"]) {
      const r = await cru<{ user_id: string }>(
        A,
        `SELECT user_id FROM finance.${tabela}`,
      );
      expect(
        r.rows.every((x) => x.user_id === A),
        tabela,
      ).toBe(true);
    }
    const forjado = await cru(A, "SELECT * FROM finance.transactions WHERE id = $1", [
      lancamentoB,
    ]);
    expect(forjado.rows).toHaveLength(0);
  });

  it("A nao edita nem apaga dado do B", async () => {
    const up = await cru(A, "UPDATE finance.transactions SET valor = 1 WHERE id = $1", [
      lancamentoB,
    ]);
    expect(up.rowCount).toBe(0);
    const del = await cru(A, "DELETE FROM finance.accounts WHERE id = $1", [contaB]);
    expect(del.rowCount).toBe(0);
    const delCat = await cru(A, "DELETE FROM finance.categories WHERE user_id = $1", [B]);
    expect(delCat.rowCount).toBe(0);
  });

  it("inserir no nome do B e recusado pelo WITH CHECK", async () => {
    await expect(
      cru(
        A,
        "INSERT INTO finance.accounts (id, user_id, nome, tipo, data_saldo_inicial) VALUES ('x', $1, 'forjada', 'corrente', '2026-03-01')",
        [B],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("FK composta: A nao aponta lancamento para conta ou categoria do B", async () => {
    // A checagem de FK ignora a RLS; e o user_id na chave que barra.
    await expect(
      cru(
        A,
        `INSERT INTO finance.transactions (id, user_id, account_id, tipo, valor, data, competencia, descricao, descricao_normalizada)
         VALUES ('t1', $1, $2, 'despesa', 1, '2026-03-01', '2026-03-01', 'x', 'X')`,
        [A, contaB],
      ),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      comoUsuario(db, A, (tx) =>
        criarLancamento(
          tx,
          A,
          NovoLancamento.parse({
            tipo: "despesa",
            valor: "1",
            data: "2026-03-01",
            descricao: "x",
            account_id: contaA,
            category_id: categoriaB,
          }),
        ),
      ),
    ).rejects.toThrow(/Categoria não encontrada/);
  });

  it("operacoes do modulo tambem nao alcancam o B", async () => {
    await expect(
      comoUsuario(db, A, (tx) => editarLancamento(tx, A, lancamentoB, { valor: "1" })),
    ).rejects.toThrow(/não encontrado/);
    await expect(
      comoUsuario(db, A, (tx) => apagarLancamento(tx, A, lancamentoB)),
    ).rejects.toThrow(/não encontrado/);
    const pagina = await comoUsuario(db, A, (tx) =>
      listarLancamentos(tx, A, FiltroDeLancamentos.parse({ conta: contaB })),
    );
    expect(pagina.meta.total).toBe(0);
  });

  it("sem usuario na sessao, nada e visivel", async () => {
    const r = await cru(null, "SELECT * FROM finance.accounts");
    expect(r.rows).toHaveLength(0);
  });

  it("auditoria e append-only e outbox so recebe insercao", async () => {
    const lida = await cru(A, "SELECT * FROM finance.audit_log");
    expect(lida.rows.length).toBeGreaterThan(0);
    await expect(cru(A, "UPDATE finance.audit_log SET acao = 'x'")).rejects.toThrow(
      /permission denied/i,
    );
    await expect(cru(A, "SELECT * FROM finance.outbox")).rejects.toThrow(
      /permission denied/i,
    );
    await expect(cru(A, "SELECT * FROM finance.dead_letter")).rejects.toThrow(
      /permission denied/i,
    );
    const ins = await cru(
      A,
      "INSERT INTO finance.outbox (id, event_name, payload, occurred_at, producer) VALUES ('e1', 'finance.teste', '{}', now(), 'web')",
    );
    expect(ins.rowCount).toBe(1);
  });

  it("o papel da aplicacao nao tem BYPASSRLS", async () => {
    const r = await dono.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'bolsiq_app'",
    );
    expect(r.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });
});

describe("operacoes do finance", () => {
  it("semear categorias e idempotente", async () => {
    expect(await comoUsuario(db, A, (tx) => semearCategorias(tx, A))).toBe(0);
    const lista = await comoUsuario(db, A, (tx) => listarCategorias(tx, A));
    expect(lista).toHaveLength(CATEGORIAS_PADRAO.length);
    expect(lista.filter((c) => c.sistema)).toHaveLength(3);
  });

  it("categoria do sistema nao se apaga", async () => {
    const lista = await comoUsuario(db, A, (tx) => listarCategorias(tx, A));
    const iof = lista.find((c) => c.nome === "IOF")?.id ?? "";
    await expect(comoUsuario(db, A, (tx) => apagarCategoria(tx, A, iof))).rejects.toThrow(
      /sistema/,
    );
  });

  it("transferencia cria o par atomicamente e nao entra nos totais", async () => {
    const lados = await comoUsuario(db, A, (tx) =>
      criarLancamento(
        tx,
        A,
        NovoLancamento.parse({
          tipo: "transferencia",
          valor: "300",
          data: "2026-03-15",
          descricao: "Reserva",
          account_id: contaA,
          conta_destino_id: poupancaA,
        }),
      ),
    );
    expect(lados).toHaveLength(2);
    expect(lados[0]?.transferencia_par_id).toBe(lados[1]?.id);

    const salario = await comoUsuario(db, A, (tx) => listarCategorias(tx, A)).then(
      (l) => l.find((c) => c.nome === "Salário")?.id ?? null,
    );
    await comoUsuario(db, A, (tx) =>
      criarLancamento(
        tx,
        A,
        NovoLancamento.parse({
          tipo: "receita",
          valor: "5000",
          data: "2026-03-05",
          descricao: "Salário",
          account_id: contaA,
          category_id: salario,
        }),
      ),
    );

    const contas = await comoUsuario(db, A, (tx) => listarContas(tx, A, HOJE));
    expect(Object.fromEntries(contas.map((c) => [c.nome, c.saldo_atual]))).toEqual({
      "Corrente A": "5700.00",
      "Poupança A": "300.00",
    });
    const resumo = await comoUsuario(db, A, (tx) =>
      resumoDoMes(tx, A, "2026-03-01", HOJE),
    );
    expect(resumo.receita.total).toBe("5000.00");
    expect(resumo.despesa.total).toBe("0.00");

    // Editar um lado edita os dois; apagar um lado apaga os dois.
    await comoUsuario(db, A, (tx) =>
      editarLancamento(tx, A, lados[1]?.id ?? "", { valor: "250" }),
    );
    const editados = await comoUsuario(db, A, (tx) =>
      tx.select().from(transactions).where(undefined),
    );
    expect(
      editados.filter((t) => t.tipo === "transferencia").map((t) => t.valor),
    ).toEqual(["250.00", "250.00"]);
    await comoUsuario(db, A, (tx) => apagarLancamento(tx, A, lados[0]?.id ?? ""));
    const restantes = await comoUsuario(db, A, (tx) => tx.select().from(transactions));
    expect(restantes.filter((t) => t.tipo === "transferencia")).toHaveLength(0);
  });

  it("transferencia que falha no meio nao deixa lado nenhum", async () => {
    await expect(
      comoUsuario(db, A, (tx) =>
        criarLancamento(
          tx,
          A,
          NovoLancamento.parse({
            tipo: "transferencia",
            valor: "10",
            data: "2026-03-15",
            descricao: "Para conta do B",
            account_id: contaA,
            conta_destino_id: contaB,
          }),
        ),
      ),
    ).rejects.toThrow(/Conta não encontrada/);
    const r = await comoUsuario(db, A, (tx) => tx.select().from(transactions));
    expect(r.filter((t) => t.tipo === "transferencia")).toHaveLength(0);
  });

  it("lista com filtro de texto, periodo e paginacao", async () => {
    for (const [descricao, data] of [
      ["Padaria São João", "2026-03-02"],
      ["Padaria do bairro", "2026-03-20"],
      ["Farmácia", "2026-03-21"],
    ] as const)
      await comoUsuario(db, A, (tx) =>
        criarLancamento(
          tx,
          A,
          NovoLancamento.parse({
            tipo: "despesa",
            valor: "12,50",
            data,
            descricao,
            account_id: contaA,
          }),
        ),
      );
    const busca = await comoUsuario(db, A, (tx) =>
      listarLancamentos(
        tx,
        A,
        FiltroDeLancamentos.parse({ q: "padaria", por_pagina: "1" }),
      ),
    );
    expect(busca.meta.total).toBe(2);
    expect(busca.data.map((l) => l.descricao)).toEqual(["Padaria do bairro"]);
    const periodo = await comoUsuario(db, A, (tx) =>
      listarLancamentos(
        tx,
        A,
        FiltroDeLancamentos.parse({ de: "2026-03-21", ate: "2026-03-31" }),
      ),
    );
    expect(periodo.data.map((l) => l.descricao)).toEqual(["Farmácia"]);
  });

  it("conta com lancamento nao se apaga direto no banco", async () => {
    const erro = await comoUsuario(db, A, (tx) => tx.delete(accounts)).catch(
      (e: { cause?: { message?: string } }) => e.cause?.message,
    );
    expect(erro).toMatch(/foreign key/i);
  });
});
