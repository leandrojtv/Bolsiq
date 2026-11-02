import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { BolsiqError, buildOpenApi } from "@bolsiq/contracts";
import { criarApp } from "../app.js";
import { carregarEnv } from "../config.js";
import type { ServicoDeDados } from "../dados/servico.js";
import { chaveDaRota, manipuladores, type AdminDeJobs } from "./registrar.js";
import { rotas } from "./specs.js";

const TOKEN = "token-de-teste-com-16+";
const meta = {
  source: "teste",
  fetched_at: "2026-11-02T19:00:00.000Z",
  license: "teste",
  stale: false,
  delay_minutes: 0,
};

const chamadas: unknown[][] = [];
const servico: ServicoDeDados = {
  buscarAtivos: (...a) => {
    chamadas.push(["buscarAtivos", ...a]);
    return Promise.resolve({ data: [], meta });
  },
  ativo: (t) => {
    if (t === "NADA3") throw new BolsiqError("not_found", "nao existe");
    return Promise.resolve({
      data: {
        ticker: t,
        isin: null,
        cnpj: null,
        cvm_code: null,
        name: "X",
        legal_name: null,
        kind: "stock",
        sector: null,
        status: null,
        provenance: {
          source: "b3-cotahist",
          fetched_at: meta.fetched_at,
          license: "x",
          source_ref: "y",
        },
      },
      meta,
    });
  },
  cotacoes: (ts) => {
    chamadas.push(["cotacoes", ts]);
    return Promise.resolve({ data: [], meta });
  },
  historico: (t, q) => {
    chamadas.push(["historico", t, q]);
    return Promise.resolve({
      data: { ticker: t, interval: q.interval, adjusted: q.adjusted, candles: [] },
      meta,
    });
  },
  proventos: (t, q) => {
    chamadas.push(["proventos", t, q]);
    return Promise.resolve({ data: [], meta });
  },
  fundamentos: (t, p) => {
    chamadas.push(["fundamentos", t, p]);
    return Promise.resolve({
      data: {
        ticker: t,
        cvm_code: "009512",
        cnpj: "33000167000101",
        period: p,
        periods: [],
      },
      meta,
    });
  },
  macro: (s, q) => {
    chamadas.push(["macro", s, q]);
    return Promise.resolve({
      data: { series: s, unit: "%", frequency: "daily", points: [] },
      meta,
    });
  },
};

const disparos: [string, Record<string, unknown>][] = [];
const admin: AdminDeJobs = {
  listar: () =>
    Promise.resolve([
      { name: "bcb-sgs", description: "x", cron: "0 6 * * *", queued: 0, last_run: null },
    ]),
  disparar: (nome, dados) => {
    disparos.push([nome, dados]);
    return Promise.resolve("id-1");
  },
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await criarApp({
    env: carregarEnv({
      DATABASE_URL: "postgres://u:p@localhost/db",
      NODE_ENV: "test",
      ADMIN_TOKEN: TOKEN,
    }),
    verificarBanco: () => Promise.resolve(true),
    servico,
    admin,
  });
});

afterAll(async () => {
  await app.close();
});

const get = (url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: "GET", url, headers });

describe("rotas /v1", () => {
  it("toda rota da spec tem manipulador, e vice-versa", () => {
    const chaves = Object.keys(manipuladores(servico, admin));
    const daSpec = rotas.filter((r) => r.path !== "/v1/health").map(chaveDaRota);
    expect(chaves.sort()).toEqual(daSpec.sort());
  });

  it("todas aparecem no OpenAPI", () => {
    const doc = buildOpenApi(
      { title: "t", version: "0", description: "d", servers: [] },
      rotas,
    ) as { paths: Record<string, unknown> };
    for (const r of rotas) expect(doc.paths[r.path]).toBeDefined();
  });

  it("busca valida e repassa o termo e o tipo", async () => {
    const r = await get("/v1/assets?q=petro&type=stock");
    expect(r.statusCode).toBe(200);
    expect(chamadas.at(-1)).toEqual(["buscarAtivos", "petro", "stock"]);
    expect((await get("/v1/assets")).statusCode).toBe(422);
    expect((await get("/v1/assets?q=x&type=cripto")).statusCode).toBe(422);
  });

  it("ticker em minusculas e normalizado; 404 do servico passa", async () => {
    const r = await get("/v1/assets/petr4");
    expect(r.json().data.ticker).toBe("PETR4");
    const nada = await get("/v1/assets/NADA3");
    expect(nada.statusCode).toBe(404);
    expect(nada.json().error.code).toBe("not_found");
  });

  it("cotacoes separa por virgula e normaliza", async () => {
    await get("/v1/quotes/petr4,%20VALE3,,");
    expect(chamadas.at(-1)).toEqual(["cotacoes", ["PETR4", "VALE3"]]);
  });

  it("historico aplica os padroes da query", async () => {
    await get("/v1/history/PETR4");
    expect(chamadas.at(-1)).toEqual([
      "historico",
      "PETR4",
      { interval: "1d", adjusted: true },
    ]);
    await get("/v1/history/PETR4?interval=1wk&adjusted=false&from=2025-01-01");
    expect(chamadas.at(-1)).toEqual([
      "historico",
      "PETR4",
      { interval: "1wk", adjusted: false, from: "2025-01-01" },
    ]);
    const ruim = await get("/v1/history/PETR4?from=2025-13-01");
    expect(ruim.statusCode).toBe(422);
    expect(ruim.json().error.details).toBeDefined();
  });

  it("proventos, fundamentos e macro", async () => {
    await get("/v1/dividends/PETR4?to=2026-01-01");
    expect(chamadas.at(-1)).toEqual(["proventos", "PETR4", { to: "2026-01-01" }]);
    await get("/v1/fundamentals/PETR4?period=quarterly");
    expect(chamadas.at(-1)).toEqual(["fundamentos", "PETR4", "quarterly"]);
    await get("/v1/macro/CDI");
    expect(chamadas.at(-1)).toEqual(["macro", "cdi", {}]);
    expect((await get("/v1/macro/dolar")).statusCode).toBe(422);
  });

  it("Swagger UI em /docs", async () => {
    const r = await get("/docs/");
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/html/);
  });
});

describe("rotas /admin", () => {
  it("exigem token", async () => {
    const sem = await get("/admin/jobs");
    expect(sem.statusCode).toBe(401);
    expect(sem.json().error.code).toBe("missing_api_key");
    const errado = await get("/admin/jobs", {
      authorization: "Bearer outro-token-qualquer!",
    });
    expect(errado.json().error.code).toBe("invalid_api_key");
  });

  it("listam e disparam com token", async () => {
    const auth = { authorization: `Bearer ${TOKEN}` };
    expect((await get("/admin/jobs", auth)).json().data[0].name).toBe("bcb-sgs");
    const r = await app.inject({
      method: "POST",
      url: "/admin/jobs/b3-cotahist-anual",
      headers: auth,
      payload: { data: { ano: 2024 } },
    });
    expect(r.json()).toEqual({ data: { job_id: "id-1", name: "b3-cotahist-anual" } });
    expect(disparos.at(-1)).toEqual(["b3-cotahist-anual", { ano: 2024 }]);
    const semCorpo = await app.inject({
      method: "POST",
      url: "/admin/jobs/bcb-sgs",
      headers: auth,
    });
    expect(semCorpo.statusCode).toBe(200);
    expect(disparos.at(-1)).toEqual(["bcb-sgs", {}]);
  });

  it("sem ADMIN_TOKEN configurado, nenhum token vale", async () => {
    const fechado = await criarApp({
      env: carregarEnv({ DATABASE_URL: "postgres://u:p@localhost/db", NODE_ENV: "test" }),
      verificarBanco: () => Promise.resolve(true),
      servico,
    });
    const r = await fechado.inject({
      method: "GET",
      url: "/admin/jobs",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.json().error.code).toBe("invalid_api_key");
    await fechado.close();
  });

  it("sem fila, admin responde 503", async () => {
    const semFila = await criarApp({
      env: carregarEnv({
        DATABASE_URL: "postgres://u:p@localhost/db",
        NODE_ENV: "test",
        ADMIN_TOKEN: TOKEN,
      }),
      verificarBanco: () => Promise.resolve(true),
      servico,
    });
    const auth = { authorization: `Bearer ${TOKEN}` };
    expect(
      (await semFila.inject({ method: "GET", url: "/admin/jobs", headers: auth }))
        .statusCode,
    ).toBe(503);
    expect(
      (await semFila.inject({ method: "POST", url: "/admin/jobs/x", headers: auth }))
        .statusCode,
    ).toBe(503);
    await semFila.close();
  });
});
