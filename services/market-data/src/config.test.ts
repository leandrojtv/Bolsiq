import { describe, expect, it } from "vitest";
import { carregarEnv, consumirFila, servirApiPublica, servirHealth } from "./config.js";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db" };

describe("carregarEnv", () => {
  it("aplica os padrões", () => {
    const env = carregarEnv(base);
    expect(env.ROLE).toBe("all");
    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("coage PORT de string para número", () => {
    expect(carregarEnv({ ...base, PORT: "8080" }).PORT).toBe(8080);
  });

  it("exige DATABASE_URL", () => {
    expect(() => carregarEnv({})).toThrow(/DATABASE_URL/);
  });

  it("recusa DATABASE_URL que não é URL", () => {
    expect(() => carregarEnv({ DATABASE_URL: "localhost" })).toThrow(/DATABASE_URL/);
  });

  it("falha alto em ROLE digitado errado, em vez de assumir um padrão", () => {
    // ADR 0006: ROLE errado subiria dois `api` e nenhum `worker`, e nada
    // pareceria errado até o primeiro job agendado não rodar.
    expect(() => carregarEnv({ ...base, ROLE: "wrker" })).toThrow(/ROLE/);
    expect(() => carregarEnv({ ...base, ROLE: "" })).toThrow(/ROLE/);
  });

  it("recusa PORT fora da faixa", () => {
    expect(() => carregarEnv({ ...base, PORT: "0" })).toThrow(/PORT/);
    expect(() => carregarEnv({ ...base, PORT: "99999" })).toThrow(/PORT/);
  });

  it("aceita os três papéis", () => {
    for (const role of ["api", "worker", "all"]) {
      expect(carregarEnv({ ...base, ROLE: role }).ROLE).toBe(role);
    }
  });
});

describe("servirApiPublica, servirHealth e consumirFila", () => {
  it("api serve a API pública e não consome fila", () => {
    expect(servirApiPublica("api")).toBe(true);
    expect(consumirFila("api")).toBe(false);
  });

  it("worker consome fila e não serve a API pública", () => {
    expect(servirApiPublica("worker")).toBe(false);
    expect(consumirFila("worker")).toBe(true);
  });

  it("all faz os dois", () => {
    expect(servirApiPublica("all")).toBe(true);
    expect(consumirFila("all")).toBe(true);
  });

  it("health é servido por todos os papéis, inclusive worker", () => {
    // Sem isto o orquestrador declara o worker unhealthy e o deploy falha
    // sem que nada esteja errado.
    for (const role of ["api", "worker", "all"] as const) {
      expect(servirHealth(role)).toBe(true);
    }
  });
});
