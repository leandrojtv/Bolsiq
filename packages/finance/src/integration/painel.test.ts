import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { comoUsuario } from "../db/sessao.js";
import {
  criarConta,
  criarLancamento,
  listarCategorias,
  semearCategorias,
  type Tx,
} from "../db/operacoes.js";
import { criarCartao } from "../db/cartoes.js";
import { definirValorDaCategoria } from "../db/planejamento.js";
import {
  evolucaoDoPatrimonio,
  gravarSnapshotDoPatrimonio,
  partesDoFinance,
} from "../db/patrimonio.js";
import { rotinaDoVigia, vigiarUsuario } from "../db/vigia.js";
import { NovaConta, NovoLancamento } from "../contratos.js";
import { NovoCartao } from "../contratos-importacao.js";
import { comporPatrimonio, PORTFOLIO_VAZIO } from "../patrimonio.js";

const HOST = process.env.TEST_HOST ?? "127.0.0.1";
const A = "user-aaa";
const B = "user-bbb";
const HOJE = "2026-11-20";

let container: StartedTestContainer;
let dono: Pool;
let db: NodePgDatabase<Record<string, unknown>>;

const comoA = <T>(f: (tx: Tx) => Promise<T>) => comoUsuario(db, A, f);
const eventos = async () =>
  (
    await dono.query<{ event_name: string; payload: { chave: string; user_id: string } }>(
      "select event_name, payload from finance.outbox where producer = 'finance' order by event_name, payload->>'chave'",
    )
  ).rows;

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
    .sort())
    for (const bloco of readFileSync(resolve(pasta, arquivo), "utf8").split(
      "--> statement-breakpoint",
    ))
      if (bloco.trim() !== "") await dono.query(bloco);
  db = drizzle(dono);

  for (const u of [A, B]) await comoUsuario(db, u, (tx) => semearCategorias(tx, u));
  const cats = await comoA((tx) => listarCategorias(tx, A));
  const categoria = (nome: string) => cats.find((c) => c.nome === nome)?.id ?? "";
  const conta = (
    await comoA((tx) =>
      criarConta(
        tx,
        A,
        NovaConta.parse({
          nome: "Corrente",
          tipo: "corrente",
          saldo_inicial: "5000",
          data_saldo_inicial: "2026-01-01",
        }),
        "2026-01-01",
      ),
    )
  ).id;
  const cartao = (
    await comoA((tx) =>
      criarCartao(
        tx,
        A,
        NovoCartao.parse({ nome: "Nubank", dia_fechamento: 15, dia_vencimento: 22 }),
        HOJE,
      ),
    )
  ).id;
  const lancar = (l: Record<string, unknown>) =>
    comoA((tx) => criarLancamento(tx, A, NovoLancamento.parse(l)));

  // Fatura que fecha em 15/11 e vence em 22/11: 2 dias, ainda a pagar.
  await lancar({
    tipo: "despesa",
    valor: "300.00",
    data: "2026-11-10",
    descricao: "Mercado",
    card_id: cartao,
    category_id: categoria("Mercado"),
  });
  // Orcamento de Restaurantes: 85 de 100 (80%).
  await comoA((tx) =>
    definirValorDaCategoria(
      tx,
      A,
      "2026-11",
      categoria("Restaurantes e delivery"),
      "100",
    ),
  );
  await lancar({
    tipo: "despesa",
    valor: "85.00",
    data: "2026-11-12",
    descricao: "Pizza",
    account_id: conta,
    category_id: categoria("Restaurantes e delivery"),
  });
  // Salario previsto para 05/11 que nao caiu.
  await lancar({
    tipo: "receita",
    valor: "6000.00",
    data: "2026-11-05",
    descricao: "Salario",
    account_id: conta,
    status: "previsto",
    category_id: categoria("Salário"),
  });
  // Uma saida prevista grande em dezembro deixa o mes negativo.
  await lancar({
    tipo: "despesa",
    valor: "20000.00",
    data: "2026-12-10",
    descricao: "Reforma",
    account_id: conta,
    status: "previsto",
  });
}, 180_000);

afterAll(async () => {
  await dono?.end().catch(() => undefined);
  await container?.stop().catch(() => undefined);
});

describe("vigia do financas", () => {
  it("publica cada fato uma vez so, mesmo rodando de novo", async () => {
    expect(await comoA((tx) => vigiarUsuario(tx, A, HOJE))).toEqual({
      fatos: 4,
      publicados: 4,
    });
    const primeira = await eventos();
    expect(primeira.map((e) => [e.event_name, e.payload.chave])).toEqual([
      ["finance.fatura.vencendo.v1", expect.stringMatching(/^fatura_vencendo:/)],
      ["finance.orcamento.limite.v1", expect.stringMatching(/^orcamento:2026-11:.+:80$/)],
      ["finance.receita.atrasada.v1", expect.stringMatching(/:2026-11-05$/)],
      ["finance.saldo.negativo.v1", "saldo_negativo:2026-12"],
    ]);
    expect(primeira.every((e) => e.payload.user_id === A)).toBe(true);

    // De hora em hora: os mesmos fatos nao voltam ao outbox.
    expect(await rotinaDoVigia(db, HOJE)).toEqual({ usuarios: 1, publicados: 0 });
    expect(await eventos()).toHaveLength(4);
  });

  it("B nao ve o que foi avisado para A", async () => {
    const r = await comoUsuario(db, B, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from finance.emitted_alerts`,
      ),
    );
    expect(r.rows[0]?.n).toBe(0);
  });
});

describe("patrimonio e foto mensal", () => {
  it("contas, faturas e dividas pelo finance", async () => {
    expect(await comoA((tx) => partesDoFinance(tx, A, HOJE))).toEqual({
      contas: "4915.00",
      faturas: "300.00",
      dividas: "0.00",
    });
  });

  it("a foto do mes e idempotente: a primeira vale", async () => {
    const parte = await comoA((tx) => partesDoFinance(tx, A, HOJE));
    const primeira = comporPatrimonio(parte, {
      ...PORTFOLIO_VAZIO,
      renda_variavel: "1000.00",
    });
    const depois = comporPatrimonio(parte, {
      ...PORTFOLIO_VAZIO,
      renda_variavel: "9999.00",
    });
    expect(
      await comoA((tx) => gravarSnapshotDoPatrimonio(tx, A, "2026-10", primeira)),
    ).toBe(true);
    expect(
      await comoA((tx) => gravarSnapshotDoPatrimonio(tx, A, "2026-10", depois)),
    ).toBe(false);
    expect(await comoA((tx) => evolucaoDoPatrimonio(tx, A))).toEqual([
      {
        mes: "2026-10",
        patrimonio_liquido: "5615.00",
        contas: "4915.00",
        investimentos: "1000.00",
        dividas: "300.00",
      },
    ]);
    expect(await comoUsuario(db, B, (tx) => evolucaoDoPatrimonio(tx, B))).toEqual([]);
  });
});
