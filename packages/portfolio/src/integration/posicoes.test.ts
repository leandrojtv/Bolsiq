import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { gravarCargaDePosicao, lerBaseDaCarga } from "../db/carga.js";
import { comoUsuario } from "../db/sessao.js";
import {
  audit_log,
  cargas_de_posicao,
  imports,
  portfolios,
  posicoes,
  transactions,
} from "../db/schema.js";
import { CargaRecusada, revisarCarga } from "../posicao-carga.js";
import { importarPosicaoBolsiq } from "../posicao-csv.js";
import type { DecisaoDeDivergencia } from "../tipos.js";

const HOST = process.env.TEST_HOST ?? "127.0.0.1";
const fixture = readFileSync(
  resolve(import.meta.dirname, "../fixtures/posicao-exemplo.csv"),
  "utf8",
);
/** A fixture com a data de uma corretora trocada, ou so com aquela corretora. */
const somente = (corretora: string, data: string) =>
  fixture
    .split("\n")
    .filter((l, i) => i === 0 || l.includes(`,${corretora},`))
    .map((l) => l.replaceAll("2026-11-05,", `${data},`))
    .join("\n");

let container: StartedTestContainer;
let pool: Pool;
let db: NodePgDatabase<Record<string, unknown>>;
let sequencia = 0;

async function novaCarteira(uid = "user-a") {
  const id = `pf-${++sequencia}`;
  await comoUsuario(db, uid, (tx) =>
    tx.insert(portfolios).values({ id, user_id: uid, nome: id }),
  );
  return id;
}

const carregar = (
  carteira: string,
  conteudo: string,
  decisoes: DecisaoDeDivergencia[] = [],
  uid = "user-a",
) =>
  comoUsuario(db, uid, (tx) =>
    gravarCargaDePosicao(tx, {
      uid,
      carteira,
      nome_arquivo: "posicao.csv",
      relatorio: importarPosicaoBolsiq(conteudo),
      decisoes,
    }),
  );

const lerPosicoes = (carteira: string, uid = "user-a") =>
  comoUsuario(db, uid, (tx) =>
    tx.select().from(posicoes).where(eq(posicoes.portfolio_id, carteira)),
  );
const lerTransacoes = (carteira: string, uid = "user-a") =>
  comoUsuario(db, uid, (tx) =>
    tx.select().from(transactions).where(eq(transactions.portfolio_id, carteira)),
  );

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
  pool = new Pool({
    connectionString: `postgres://dono:dono@${HOST}:${container.getMappedPort(5432)}/ci`,
    max: 3,
  });
  const pasta = resolve(import.meta.dirname, "../../migrations");
  for (const arquivo of readdirSync(pasta)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(resolve(pasta, arquivo), "utf8");
    for (const bloco of sql.split("--> statement-breakpoint")) {
      if (bloco.trim() !== "") await pool.query(bloco);
    }
  }
  db = drizzle(pool);
}, 180_000);

afterAll(async () => {
  await pool?.end().catch(() => undefined);
  await container?.stop().catch(() => undefined);
});

describe("carga de posicao contra Postgres real", () => {
  it("a fixture grava 1 saldo inicial, 4 posicoes, importacao e auditoria", async () => {
    const carteira = await novaCarteira();
    const r = await carregar(carteira, fixture);
    expect(r.transacoes_geradas).toBe(1);
    expect(r.posicoes_gravadas).toBe(4);

    const lidas = await lerPosicoes(carteira);
    expect(lidas).toHaveLength(4);
    expect(lidas.every((p) => p.vigente)).toBe(true);
    const cdb = lidas.find((p) => p.classe === "renda_fixa");
    expect(cdb).toMatchObject({
      corretora: "Nubank",
      saldo_bruto: "10356.200000",
      pct_indexador: "1.20000000",
      taxa_aa: null,
      data_aplicacao: "2026-08-11",
      liquidez_diaria: false,
      importacao_id: r.importacao_id,
    });

    const txs = await lerTransacoes(carteira);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      ticker: "ITUB4",
      tipo: "saldo_inicial",
      data: "2026-11-05",
      quantidade: "85.00000000",
      preco: "41.160000",
      corretora: "XP",
      importacao_id: r.importacao_id,
    });

    await comoUsuario(db, "user-a", async (tx) => {
      const [imp] = await tx
        .select()
        .from(imports)
        .where(eq(imports.id, r.importacao_id));
      expect(imp).toMatchObject({
        formato: "posicao_bolsiq",
        linhas_lidas: 9,
        linhas_aceitas: 5,
        linhas_rejeitadas: 4,
      });
      const auditoria = await tx
        .select()
        .from(audit_log)
        .where(eq(audit_log.recurso_id, carteira));
      expect(auditoria.map((a) => a.detalhe)).toEqual(["posicao_bolsiq: 5 de 9"]);
      const [marcada] = await tx
        .select({ desde: portfolios.recalcular_desde })
        .from(portfolios)
        .where(eq(portfolios.id, carteira));
      expect(marcada?.desde).toBe("2026-11-05");
    });
  });

  it("a mesma fixture de novo e recusada, e nada muda", async () => {
    const carteira = await novaCarteira();
    await carregar(carteira, fixture);
    await expect(carregar(carteira, fixture)).rejects.toBeInstanceOf(CargaRecusada);
    expect(await lerPosicoes(carteira)).toHaveLength(4);
    expect(await lerTransacoes(carteira)).toHaveLength(1);
  });

  it("carga mais recente da corretora substitui so as posicoes dela", async () => {
    const carteira = await novaCarteira();
    await carregar(carteira, fixture);
    const r = await carregar(carteira, somente("XP", "2026-11-06"));
    expect(r.revisao.divergencias).toEqual([]);
    expect(r.transacoes_geradas).toBe(0);

    const lidas = await lerPosicoes(carteira);
    const vigentes = lidas.filter((p) => p.vigente);
    expect(lidas).toHaveLength(6);
    expect(vigentes).toHaveLength(4);
    expect(
      vigentes
        .filter((p) => p.corretora === "XP")
        .map((p) => p.data_posicao)
        .sort(),
    ).toEqual(["2026-11-06", "2026-11-06"]);
    expect(
      vigentes.filter((p) => p.corretora !== "XP").map((p) => p.data_posicao),
    ).toEqual(["2026-11-05", "2026-11-05"]);
    expect(lidas.filter((p) => !p.vigente).map((p) => p.corretora)).toEqual(["XP", "XP"]);
    expect(await lerTransacoes(carteira)).toHaveLength(1);
  });

  it("carga mais antiga e recusada, a de outra corretora nao afeta nada", async () => {
    const carteira = await novaCarteira();
    await carregar(carteira, somente("XP", "2026-11-05"));
    await expect(carregar(carteira, somente("XP", "2026-11-01"))).rejects.toThrow(
      /XP: o arquivo é de 01\/11\/2026 e já existe carga de 05\/11\/2026/,
    );
    await carregar(carteira, somente("Santander", "2026-10-01"));
    const lidas = await lerPosicoes(carteira);
    expect(lidas.filter((p) => p.corretora === "XP" && p.vigente)).toHaveLength(2);
    expect(lidas.filter((p) => p.corretora === "Santander" && p.vigente)).toHaveLength(1);
  });

  it("corretora so com renda variavel tambem recusa a carga repetida", async () => {
    const carteira = await novaCarteira();
    const so = fixture
      .split("\n")
      .filter((l, i) => i === 0 || l.includes(",ITUB4,ITUB4,"))
      .join("\n");
    await carregar(carteira, so);
    expect(await lerPosicoes(carteira)).toEqual([]);
    await expect(carregar(carteira, so)).rejects.toBeInstanceOf(CargaRecusada);
  });

  it("divergencia nao gera transacao sozinha; com a decisao, gera o ajuste", async () => {
    const carteira = await novaCarteira();
    await comoUsuario(db, "user-a", (tx) =>
      tx.insert(transactions).values({
        id: `tx-${carteira}`,
        portfolio_id: carteira,
        user_id: "user-a",
        ticker: "ITUB4",
        tipo: "compra",
        data: "2026-01-02",
        quantidade: "80",
        preco: "30",
        corretora: "XP",
      }),
    );
    const base = await comoUsuario(db, "user-a", (tx) => lerBaseDaCarga(tx, carteira));
    const revisao = revisarCarga(importarPosicaoBolsiq(fixture), base);
    expect(revisao.saldos_iniciais).toEqual([]);
    expect(revisao.divergencias[0]).toMatchObject({
      ticker: "ITUB4",
      sistema: "80",
      extrato: "85",
    });

    await carregar(carteira, somente("XP", "2026-11-05"));
    expect(await lerTransacoes(carteira)).toHaveLength(1);

    await carregar(carteira, somente("XP", "2026-11-06"), [
      { corretora: "XP", ticker: "ITUB4", acao: "gerar_ajuste" },
    ]);
    const txs = await lerTransacoes(carteira);
    expect(txs.find((t) => t.data === "2026-11-06")).toMatchObject({
      tipo: "compra",
      quantidade: "5.00000000",
      preco: "38.490000",
    });
  });

  it("RLS: usuario B nao ve nem altera as posicoes de A", async () => {
    const carteira = await novaCarteira();
    await carregar(carteira, fixture);
    expect(await lerPosicoes(carteira, "user-b")).toEqual([]);
    await comoUsuario(db, "user-b", async (tx) => {
      expect(await tx.select().from(cargas_de_posicao)).toEqual([]);
      const r = await tx
        .update(posicoes)
        .set({ vigente: false })
        .where(eq(posicoes.portfolio_id, carteira));
      expect(r.rowCount).toBe(0);
    });
    await expect(
      comoUsuario(db, "user-b", (tx) =>
        tx.insert(posicoes).values({
          id: "forjada",
          portfolio_id: carteira,
          user_id: "user-a",
          importacao_id: "x",
          corretora: "XP",
          data_posicao: "2026-11-05",
          chave_ativo: "x",
          classe: "outro",
          ativo: "x",
          saldo_bruto: "1",
          valorizacao: "manual",
        }),
      ),
    ).rejects.toThrow();
    expect((await lerPosicoes(carteira)).every((p) => p.vigente)).toBe(true);
  });

  it("as duas tabelas novas tem RLS habilitada e forcada", async () => {
    const r = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'portfolio' AND c.relname IN ('posicoes', 'cargas_de_posicao')`,
    );
    expect(r.rows).toHaveLength(2);
    for (const t of r.rows) {
      expect(t.relrowsecurity, t.relname).toBe(true);
      expect(t.relforcerowsecurity, t.relname).toBe(true);
    }
  });

  it("erro no meio desfaz tudo: posicoes anteriores seguem vigentes", async () => {
    const carteira = await novaCarteira();
    await carregar(carteira, fixture);
    // Valor maior que numeric(20,6) estoura no insert, depois de desligar as vigentes.
    const estouro = somente("XP", "2026-11-06").replace(
      "12884.64",
      "123456789012345678901",
    );
    await expect(carregar(carteira, estouro)).rejects.toThrow();

    const lidas = await lerPosicoes(carteira);
    expect(lidas).toHaveLength(4);
    expect(lidas.every((p) => p.vigente && p.data_posicao === "2026-11-05")).toBe(true);
    expect(await lerTransacoes(carteira)).toHaveLength(1);
    await carregar(carteira, somente("XP", "2026-11-06"));
  });

  it("indice parcial impede duas vigentes do mesmo ativo e aceita historico", async () => {
    const carteira = await novaCarteira();
    await carregar(carteira, fixture);
    const [xp] = (await lerPosicoes(carteira)).filter((p) => p.corretora === "XP");
    await expect(
      comoUsuario(db, "user-a", (tx) =>
        tx
          .insert(posicoes)
          .values({ ...(xp as typeof posicoes.$inferInsert), id: "dup" }),
      ),
    ).rejects.toThrow();
    await comoUsuario(db, "user-a", (tx) =>
      tx.insert(posicoes).values({
        ...(xp as typeof posicoes.$inferInsert),
        id: "historico",
        vigente: false,
      }),
    );
  });
});
