import { describe, expect, it } from "vitest";
import {
  Cnpj,
  IsoDate,
  IsoDateTime,
  Isin,
  Money,
  Provenance,
  Ticker,
} from "./primitives.js";

describe("Money", () => {
  it("aceita string decimal", () => {
    expect(Money.parse("38.42")).toBe("38.42");
    expect(Money.parse("0")).toBe("0");
    expect(Money.parse("-1.5")).toBe("-1.5");
    expect(Money.parse("1234567890.123456")).toBe("1234567890.123456");
  });

  it("recusa number, para não reintroduzir ponto flutuante em moeda", () => {
    expect(() => Money.parse(38.42)).toThrow();
  });

  it("recusa notação científica e texto", () => {
    expect(() => Money.parse("3.8e1")).toThrow();
    expect(() => Money.parse("R$ 38,42")).toThrow();
    expect(() => Money.parse("")).toThrow();
  });
});

describe("IsoDate", () => {
  it("aceita YYYY-MM-DD", () => {
    expect(IsoDate.parse("2026-10-31")).toBe("2026-10-31");
  });

  it("recusa formato brasileiro, que é o que a CVM e o BCB devolvem", () => {
    expect(() => IsoDate.parse("31/10/2026")).toThrow();
  });
});

describe("IsoDateTime", () => {
  it("exige offset explícito", () => {
    expect(IsoDateTime.parse("2026-10-31T22:14:03Z")).toBe("2026-10-31T22:14:03Z");
    expect(() => IsoDateTime.parse("2026-10-31T22:14:03")).toThrow();
  });
});

describe("Cnpj", () => {
  it("exige 14 dígitos sem pontuação", () => {
    expect(Cnpj.parse("33000167000101")).toBe("33000167000101");
    expect(() => Cnpj.parse("33.000.167/0001-01")).toThrow();
    expect(() => Cnpj.parse("3300016700010")).toThrow();
  });
});

describe("Ticker", () => {
  it("aceita ticker da B3", () => {
    expect(Ticker.parse("PETR4")).toBe("PETR4");
    expect(Ticker.parse("BOVA11")).toBe("BOVA11");
  });

  it("recusa minúsculas e tamanho fora da faixa", () => {
    expect(() => Ticker.parse("petr4")).toThrow();
    expect(() => Ticker.parse("AB")).toThrow();
  });
});

describe("Isin", () => {
  it("aceita ISIN válido e recusa malformado", () => {
    expect(Isin.parse("BRPETRACNPR6")).toBe("BRPETRACNPR6");
    expect(() => Isin.parse("PETR4")).toThrow();
  });
});

describe("Provenance", () => {
  it("exige os quatro campos da regra 4", () => {
    const valido = {
      source: "b3-cotahist",
      fetched_at: "2026-10-31T22:14:03Z",
      license: "proprietária — B3",
      source_ref: "COTAHIST_A2026.ZIP",
    };
    expect(Provenance.parse(valido)).toEqual(valido);

    for (const campo of ["source", "fetched_at", "license", "source_ref"]) {
      const incompleto: Record<string, unknown> = { ...valido };
      delete incompleto[campo];
      expect(() => Provenance.parse(incompleto)).toThrow();
    }
  });

  it("recusa campo vazio", () => {
    expect(() =>
      Provenance.parse({
        source: "",
        fetched_at: "2026-10-31T22:14:03Z",
        license: "x",
        source_ref: "y",
      }),
    ).toThrow();
  });
});
