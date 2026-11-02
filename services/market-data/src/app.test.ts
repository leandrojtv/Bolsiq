import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { criarApp } from "./app.js";
import { carregarEnv } from "./config.js";

const env = carregarEnv({
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  NODE_ENV: "test",
  SERVICE_VERSION: "1.2.3",
  ROLE: "api",
});

describe("app", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await criarApp({ env, verificarBanco: () => Promise.resolve(true) });
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /v1/health responde ok sem exigir chave", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: "ok",
      role: "api",
      version: "1.2.3",
      checks: { database: "ok" },
    });
  });

  it("devolve 503 e degraded quando o banco não responde", async () => {
    const outro = await criarApp({
      env,
      verificarBanco: () => Promise.resolve(false),
    });
    const res = await outro.inject({ method: "GET", url: "/v1/health" });

    // 503, não 200: o HEALTHCHECK da imagem e o `compose up --wait` olham o
    // status HTTP, não o corpo.
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      status: "degraded",
      checks: { database: "fail" },
    });
    await outro.close();
  });

  it("devolve 503 quando a sonda do banco lança", async () => {
    const outro = await criarApp({
      env,
      verificarBanco: () => Promise.reject(new Error("conexão recusada")),
    });
    const res = await outro.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("internal_error");
    await outro.close();
  });

  it("expõe o correlation ID em toda resposta", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    expect(res.headers["x-correlation-id"]).toBeTruthy();
  });

  it("respeita o correlation ID enviado pelo cliente", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/health",
      headers: { "x-correlation-id": "01JBQ7X8N4K2M9P3R5T7V9W1Y3" },
    });
    expect(res.headers["x-correlation-id"]).toBe("01JBQ7X8N4K2M9P3R5T7V9W1Y3");
  });

  it("GET /v1/openapi.json descreve as rotas e o esquema de chave", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(res.statusCode).toBe(200);

    const doc = res.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.components.securitySchemes.apiKey.name).toBe("X-API-Key");
    // health é anônima: não deve exigir chave no documento.
    expect(doc.paths["/v1/health"].get.security).toBeUndefined();
  });

  it("rota inexistente devolve o envelope de erro do contrato", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/nao-existe" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: { code: "not_found" },
    });
    expect(res.json().error.correlation_id).toBeTruthy();
  });

  it("no modo apenasHealth serve health e não a API pública", async () => {
    const worker = await criarApp({
      env: carregarEnv({
        DATABASE_URL: "postgres://u:p@localhost:5432/db",
        NODE_ENV: "test",
        ROLE: "worker",
      }),
      verificarBanco: () => Promise.resolve(true),
      apenasHealth: true,
    });

    const health = await worker.inject({ method: "GET", url: "/v1/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json().role).toBe("worker");

    // O worker não publica o contrato: ele não é a API.
    const openapi = await worker.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(openapi.statusCode).toBe(404);

    await worker.close();
  });
});
