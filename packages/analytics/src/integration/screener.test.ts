import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { criarDb, criarPool, type Db } from "@bolsiq/db-core";
import { DFP_2024 } from "../cvm.fixtures.js";
import { executarScreener } from "../executarScreener.js";
import { filtroDoPreset, FiltroDeScreener } from "../screener.js";
import { outbox } from "../db/schema.js";
import { recalcularTicker, type ClienteDoMarketData } from "../worker.js";

const HOST = process.env.TEST_HOST ?? "127.0.0.1";
let container: StartedTestContainer;
let pool: ReturnType<typeof criarPool>;
let db: Db;

const meta = {
  source: "t",
  fetched_at: "2026-11-02T00:00:00.000Z",
  license: "t",
  stale: false,
  delay_minutes: 0,
};

function velas(preco: number) {
  return Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10),
    open: String(preco),
    high: String(preco),
    low: String(preco),
    close: String(preco + (i % 2) * 0.1),
    volume: 1000,
    financial_volume: "5000000",
  }));
}

/** market-data falso: PETR4 com o DFP 2024 real e um FII sem demonstrativo. */
const cliente: ClienteDoMarketData = {
  ativo: (t) =>
    Promise.resolve(
      t === "SUMIU3"
        ? null
        : {
            data: {
              ticker: t,
              isin: null,
              cnpj: null,
              cvm_code: t === "PETR4" ? "009512" : null,
              name: t,
              legal_name: null,
              kind: t === "PETR4" ? "stock" : "fii",
              sector: t === "PETR4" ? "Petróleo e Gás" : null,
              status: null,
              provenance: {
                source: "t",
                fetched_at: meta.fetched_at,
                license: "t",
                source_ref: "t",
              },
            },
            meta,
          },
    ),
  historico: (t, ajustado) =>
    Promise.resolve({
      data: {
        ticker: t,
        interval: "1d",
        adjusted: ajustado,
        candles: velas(t === "PETR4" ? 30 : 100),
      },
      meta,
    }),
  fundamentos: (t) => {
    const d = DFP_2024.PETR4.demonstrativo;
    return Promise.resolve({
      data: {
        ticker: t,
        cvm_code: "009512",
        cnpj: "33000167000101",
        period: "annual",
        periods: [
          {
            reference_date: d.reference_date,
            period_start: "2024-01-01",
            statement_kind: "DFP",
            consolidated: true,
            revenue: d.receita,
            gross_profit: d.resultado_bruto,
            ebit: d.ebit,
            net_income: d.lucro_liquido,
            depreciation_amortization: d.depreciacao_amortizacao,
            total_assets: d.ativo_total,
            current_assets: d.ativo_circulante,
            cash_and_equivalents: d.caixa_equivalentes,
            current_liabilities: d.passivo_circulante,
            equity: d.patrimonio_liquido,
            gross_debt: d.divida_bruta,
            shares_outstanding: DFP_2024.PETR4.acoes,
            version: 1,
          },
        ],
      },
      meta,
    });
  },
  proventos: (t) =>
    Promise.resolve({
      // KNCR11 sem proventos na brapi (sem BRAPI_TOKEN): o DY vem do informe.
      data:
        t === "KNCR11"
          ? []
          : [
              {
                ticker: t,
                kind: "dividendo",
                ex_date: "2026-06-01",
                payment_date: null,
                approved_on: null,
                value_per_share: "8",
                factor: null,
                ratio: null,
              },
            ],
      meta,
    }),
  informesFii: (t) =>
    Promise.resolve(
      t === "KNCR11"
        ? {
            data: {
              ticker: t,
              cnpj: "16706958000132",
              name: "KINEA RENDIMENTOS",
              segment: "Multicategoria",
              reports: [
                {
                  reference_date: "2026-09-01",
                  version: 1,
                  total_assets: "11126511594.66",
                  equity: "10984431830.65",
                  shares_outstanding: "107089622",
                  nav_per_share: "102.572327",
                  holders: 593709,
                  dividend_yield_month: "0.01101",
                  effective_return_month: "0.010396",
                  amortization_month: "0",
                  dividends_payable: null,
                  provenance: {
                    source: "cvm-fii-mensal",
                    fetched_at: meta.fetched_at,
                    license: "ODbL-1.0",
                    source_ref: "inf_mensal_fii_2026.zip#inf_mensal_fii_geral",
                  },
                },
              ],
            },
            meta,
          }
        : null,
    ),
  macro: (s) =>
    Promise.resolve({
      data: { series: s, unit: "x", frequency: "daily", points: [] },
      meta,
    }),
};

beforeAll(async () => {
  container = await new GenericContainer("timescale/timescaledb-ha:pg17")
    .withEnvironment({
      POSTGRES_USER: "bolsiq",
      POSTGRES_PASSWORD: "bolsiq",
      POSTGRES_DB: "bolsiq",
    })
    .withExposedPorts(5432)
    // A imagem sobe um Postgres temporario para o init e reinicia: a porta
    // abre antes de o banco aceitar conexao ("the database system is
    // starting up"). O temporario so escuta no socket, entao o pg_isready
    // por TCP so passa no servidor definitivo.
    .withWaitStrategy(Wait.forSuccessfulCommand("pg_isready -h 127.0.0.1 -p 5432"))
    .withStartupTimeout(120_000)
    .start();
  pool = criarPool({
    url: `postgres://bolsiq:bolsiq@${HOST}:${container.getMappedPort(5432)}/bolsiq`,
    maxConnections: 2,
  });
  await migrate(drizzle(pool), {
    migrationsFolder: resolve(import.meta.dirname, "../../migrations"),
    migrationsSchema: "drizzle_analytics",
  });
  db = criarDb(pool);
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe("recalculo e screener", () => {
  it("recalcula a partir do /v1 e o screener encontra", async () => {
    const macro = { cdi: [], ibov: [] };
    expect(await recalcularTicker(db, cliente, "PETR4", macro)).toBe("ok");
    expect(await recalcularTicker(db, cliente, "HGLG11", macro)).toBe("ok");
    expect(await recalcularTicker(db, cliente, "SUMIU3", macro)).toBe("sem_ativo");

    const todos = await executarScreener(
      db,
      FiltroDeScreener.parse({ ordenar_por: "dy_12m", ordem: "desc" }),
    );
    expect(todos.total).toBe(2);
    expect(todos.linhas.map((l) => l.ticker)).toEqual(["PETR4", "HGLG11"]);

    // P/L de PETR4 a R$ 30 com LPA 2,87: cerca de 10,5.
    const porPl = await executarScreener(
      db,
      FiltroDeScreener.parse({
        faixas: { pl: { min: 5, max: 15 } },
        tipos: ["stock"],
        setores: ["Petróleo e Gás"],
      }),
    );
    expect(porPl.linhas).toHaveLength(1);
    expect(porPl.linhas[0]?.indicadores.pl).toBeCloseTo(10.5, 0);
    expect(Number(porPl.linhas[0]?.preco)).toBeCloseTo(30, 0);

    // FII nao tem P/L: fica fora de um filtro por P/L.
    const fiiPorPl = await executarScreener(
      db,
      FiltroDeScreener.parse({ tipos: ["fii"] }),
    );
    expect(fiiPorPl.total).toBe(0);

    const graham = await executarScreener(db, filtroDoPreset("graham"));
    expect(graham.linhas.map((l) => l.ticker)).toEqual(["PETR4"]);

    const liquidez = await executarScreener(
      db,
      FiltroDeScreener.parse({ liquidez_minima: 10_000_000, incluir_indefinidos: true }),
    );
    expect(liquidez.total).toBe(0);
  });

  it("publica analytics.indicators.updated so quando muda", async () => {
    const eventos = async () =>
      (await db.select().from(outbox)).filter(
        (e) => (e.payload as { ticker: string }).ticker === "PETR4",
      );
    const antes = await eventos();
    expect(antes).toHaveLength(1);
    expect(antes[0]?.eventName).toBe("analytics.indicators.updated.v1");
    expect(antes[0]?.payload).toMatchObject({
      ticker: "PETR4",
      reference_date: "2024-12-31",
    });
    await recalcularTicker(db, cliente, "PETR4", { cdi: [], ibov: [] });
    expect(await eventos()).toHaveLength(1);
  });

  it("FII com informe e filtravel por P/VP, DY 12m, patrimonio e cotistas", async () => {
    expect(await recalcularTicker(db, cliente, "KNCR11", { cdi: [], ibov: [] })).toBe(
      "ok",
    );
    const r = await executarScreener(
      db,
      FiltroDeScreener.parse({
        tipos: ["fii"],
        faixas: {
          pvp: { max: 1.2 },
          patrimonio_liquido: { min: 1e9 },
          cotistas: { min: 1000 },
        },
        ordenar_por: "pvp",
      }),
    );
    expect(r.linhas.map((l) => l.ticker)).toEqual(["KNCR11"]);
    // Preco ~100 sobre VP 102,57; um mes de 1,101% de DY sobre o VP.
    expect(r.linhas[0]?.indicadores.pvp).toBeCloseTo(0.975, 2);
    expect(r.linhas[0]?.indicadores.dy_12m).toBeCloseTo(
      (0.01101 * 102.572327) / 100.1,
      3,
    );
    expect(r.linhas[0]?.indicadores.cotistas).toBe(593709);
    // HGLG11 ficou sem informe: sem P/VP, fora da ordenacao por P/VP.
    const porDy = await executarScreener(
      db,
      FiltroDeScreener.parse({ tipos: ["fii"], ordenar_por: "dy_12m", ordem: "desc" }),
    );
    expect(porDy.linhas.map((l) => l.ticker).sort()).toEqual(["HGLG11", "KNCR11"]);
  });

  it("recalcular de novo sobrescreve a mesma data-base", async () => {
    await recalcularTicker(db, cliente, "PETR4", { cdi: [], ibov: [] });
    const r = await executarScreener(
      db,
      FiltroDeScreener.parse({ ordenar_por: "pl", incluir_indefinidos: true }),
    );
    expect(r.total).toBe(3);
  });
});
