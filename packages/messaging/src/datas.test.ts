import { describe, expect, it } from "vitest";
import { paraIsoUtc } from "./datas.js";
import { EventEnvelope } from "@bolsiq/contracts";

describe("paraIsoUtc", () => {
  it("converte o formato que o Postgres devolve", () => {
    // Formato real do driver para timestamptz: espaço e offset abreviado.
    expect(paraIsoUtc("2026-10-31 21:05:00+00")).toBe("2026-10-31T21:05:00.000Z");
    expect(paraIsoUtc("2026-10-31 18:05:00-03")).toBe("2026-10-31T21:05:00.000Z");
  });

  it("preserva valor já em ISO", () => {
    expect(paraIsoUtc("2026-10-31T21:05:00.000Z")).toBe("2026-10-31T21:05:00.000Z");
    expect(paraIsoUtc("2026-10-31T21:05:00Z")).toBe("2026-10-31T21:05:00.000Z");
    expect(paraIsoUtc("2026-10-31T18:05:00-03:00")).toBe("2026-10-31T21:05:00.000Z");
  });

  it("aceita Date", () => {
    expect(paraIsoUtc(new Date("2026-10-31T21:05:00Z"))).toBe("2026-10-31T21:05:00.000Z");
  });

  it("preserva milissegundos", () => {
    expect(paraIsoUtc("2026-10-31 21:05:00.123+00")).toBe("2026-10-31T21:05:00.123Z");
  });

  it("o resultado sempre satisfaz o schema do envelope", () => {
    // É esta a garantia que importa: o que sai daqui tem de passar pelo
    // consumidor. Foi aqui que os cinco eventos caíram na dead-letter.
    for (const entrada of [
      "2026-10-31 21:05:00+00",
      "2026-10-31 18:05:00-03",
      "2026-10-31T21:05:00Z",
    ]) {
      const envelope = {
        id: "0193a1f0-4f7c-7000-8000-000000000001",
        name: "marketdata.quote.updated.v1",
        occurred_at: paraIsoUtc(entrada),
        producer: "market-data",
        payload: {},
      };
      expect(() => EventEnvelope.parse(envelope), entrada).not.toThrow();
    }
  });

  it("recusa entrada inválida em vez de publicar lixo", () => {
    expect(() => paraIsoUtc("não é data")).toThrow(/inválido/);
    expect(() => paraIsoUtc("")).toThrow(/inválido/);
    expect(() => paraIsoUtc("   ")).toThrow(/inválido/);
    expect(() => paraIsoUtc(new Date("x"))).toThrow(/Invalid Date/);
  });
});
