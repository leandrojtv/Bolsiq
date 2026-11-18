import { describe, expect, it } from "vitest";
import { Coalescedor, dentroDoPrazo } from "./coalescedor.js";
import { preferir } from "./ingestao.js";
import { ultimoPregaoEsperado } from "./servico.js";

describe("Coalescedor", () => {
  it("chamadas simultaneas da mesma chave executam uma vez", async () => {
    const c = new Coalescedor();
    let execucoes = 0;
    const lenta = () =>
      new Promise<number>((ok) => {
        execucoes++;
        setTimeout(() => ok(42), 20);
      });
    const r = await Promise.all([
      c.executar("k", lenta),
      c.executar("k", lenta),
      c.executar("j", lenta),
    ]);
    expect(r).toEqual([42, 42, 42]);
    expect(execucoes).toBe(2);
    expect(c.tamanho).toBe(0);
  });

  it("erro nao fica em cache", async () => {
    const c = new Coalescedor();
    await expect(c.executar("k", () => Promise.reject(new Error("x")))).rejects.toThrow(
      "x",
    );
    expect(await c.executar("k", () => Promise.resolve(1))).toBe(1);
  });

  it("prazo", () => {
    const agora = new Date("2026-11-02T12:00:00Z");
    expect(dentroDoPrazo(null, 1000, agora)).toBe(false);
    expect(dentroDoPrazo("2026-11-02T11:59:59.500Z", 1000, agora)).toBe(true);
    expect(dentroDoPrazo("2026-11-02T11:59:58Z", 1000, agora)).toBe(false);
  });
});

describe("ultimoPregaoEsperado", () => {
  it("espera o pregao do dia so depois do job das 20:30", () => {
    // Quarta, 20:00 em Sao Paulo: o job ainda nao rodou, vale terca.
    expect(ultimoPregaoEsperado(new Date("2026-11-04T23:00:00Z"))).toBe("2026-11-03");
    // Quarta, 21:00: ja vale quarta.
    expect(ultimoPregaoEsperado(new Date("2026-11-05T00:00:00Z"))).toBe("2026-11-04");
  });

  it("antes das 21h de Sao Paulo vale o pregao anterior", () => {
    // Segunda, 15h em Sao Paulo: o ultimo carregado e o de sexta.
    expect(ultimoPregaoEsperado(new Date("2026-11-02T18:00:00Z"))).toBe("2026-10-30");
    // Segunda, 21h: o de segunda.
    expect(ultimoPregaoEsperado(new Date("2026-11-03T00:00:00Z"))).toBe("2026-11-02");
    // Domingo: sexta.
    expect(ultimoPregaoEsperado(new Date("2026-11-01T23:30:00Z"))).toBe("2026-10-30");
  });
});

describe("preferir", () => {
  const base = {
    cnpj: "1",
    cvmCode: "009512",
    referenceDate: "2025-06-30",
    periodEnd: "2025-06-30",
    statementType: "DRE",
    isConsolidated: true,
    accountCode: "3.01",
    accountLabel: "Receita",
    amount: "1",
    currency: "REAL",
    sourceRef: "x",
  };

  it("maior versao vence", () => {
    const a = { ...base, version: 2, periodStart: "2025-01-01" };
    const b = { ...base, version: 1, periodStart: "2025-04-01" };
    expect(preferir(a, b)).toBe(a);
    expect(preferir(b, a)).toBe(a);
  });

  it("na mesma versao, o trimestre vence o acumulado", () => {
    const acumulado = { ...base, version: 1, periodStart: "2025-01-01" };
    const trimestre = { ...base, version: 1, periodStart: "2025-04-01" };
    expect(preferir(acumulado, trimestre)).toBe(trimestre);
    expect(preferir(trimestre, acumulado)).toBe(trimestre);
  });
});
