import { describe, expect, it } from "vitest";
import { compararComBenchmark, twrAcumulado, twrDiario } from "./twr.js";

describe("twrDiario", () => {
  it("primeiro dia nao tem retorno", () => {
    const p = twrDiario([{ data: "2024-01-01", valor: "1000", fluxo_caixa: "1000" }]);
    expect(p[0]?.retorno_diario).toBeNull();
    expect(p[0]?.base_100).toBe(100);
  });

  it("sem fluxo, o retorno e a variacao do valor", () => {
    const p = twrDiario([
      { data: "2024-01-01", valor: "1000", fluxo_caixa: "1000" },
      { data: "2024-01-02", valor: "1100", fluxo_caixa: "0" },
    ]);
    expect(p[1]?.retorno_diario).toBeCloseTo(0.1, 10);
    expect(p[1]?.base_100).toBeCloseTo(110, 6);
  });

  it("aporte nao vira rentabilidade", () => {
    // Carteira de 1000 recebe 1000 e termina em 2000: rendeu zero.
    const p = twrDiario([
      { data: "2024-01-01", valor: "1000", fluxo_caixa: "1000" },
      { data: "2024-01-02", valor: "2000", fluxo_caixa: "1000" },
    ]);
    expect(p[1]?.retorno_diario).toBeCloseTo(0, 10);
    expect(p[1]?.base_100).toBeCloseTo(100, 6);
  });

  it("retirada tambem e neutralizada", () => {
    const p = twrDiario([
      { data: "2024-01-01", valor: "1000", fluxo_caixa: "1000" },
      { data: "2024-01-02", valor: "500", fluxo_caixa: "-500" },
    ]);
    expect(p[1]?.retorno_diario).toBeCloseTo(0, 10);
  });

  it("vender a carteira inteira mede a variacao do dia, nao -100%", () => {
    // 1000 sobe 10% e e vendida inteira no fechamento: 1100 saem.
    const p = twrDiario([
      { data: "2024-01-01", valor: "1000", fluxo_caixa: "1000" },
      { data: "2024-01-02", valor: "0", fluxo_caixa: "-1100" },
    ]);
    expect(p[1]?.retorno_diario).toBeCloseTo(0.1, 10);
  });

  it("aporte com valorizacao separa as duas coisas", () => {
    // 1000 + aporte de 1000, fecha em 2200: 10% sobre 2000.
    const p = twrDiario([
      { data: "2024-01-01", valor: "1000", fluxo_caixa: "1000" },
      { data: "2024-01-02", valor: "2200", fluxo_caixa: "1000" },
    ]);
    expect(p[1]?.retorno_diario).toBeCloseTo(0.1, 10);
  });

  it("carteira que comeca o dia em zero nao tem retorno", () => {
    const p = twrDiario([
      { data: "2024-01-01", valor: "0", fluxo_caixa: "0" },
      { data: "2024-01-02", valor: "100", fluxo_caixa: "0" },
    ]);
    expect(p[1]?.retorno_diario).toBeNull();
  });

  it("serie vazia devolve serie vazia", () => {
    expect(twrDiario([])).toEqual([]);
  });
});

describe("twrAcumulado", () => {
  it("compoe os retornos diarios", () => {
    const p = twrDiario([
      { data: "2024-01-01", valor: "100", fluxo_caixa: "100" },
      { data: "2024-01-02", valor: "110", fluxo_caixa: "0" },
      { data: "2024-01-03", valor: "121", fluxo_caixa: "0" },
    ]);
    expect(twrAcumulado(p)).toBeCloseTo(0.21, 8);
  });

  it("serie sem retorno e indefinida", () => {
    expect(twrAcumulado([])).toBeNull();
    expect(
      twrAcumulado(twrDiario([{ data: "2024-01-01", valor: "1", fluxo_caixa: "1" }])),
    ).toBeNull();
  });
});

describe("compararComBenchmark", () => {
  it("benchmark recebe os mesmos dias, nao os mesmos fluxos", () => {
    const p = twrDiario([
      { data: "2024-01-01", valor: "1000", fluxo_caixa: "1000" },
      { data: "2024-01-02", valor: "2200", fluxo_caixa: "1000" },
    ]);
    const c = compararComBenchmark(p, [0, 0.05]);
    expect(c[0]).toEqual({ data: "2024-01-01", carteira: 100, benchmark: 100 });
    expect(c[1]?.carteira).toBeCloseTo(110, 6);
    expect(c[1]?.benchmark).toBeCloseTo(105, 6);
  });

  it("benchmark faltando no dia conta como zero", () => {
    const p = twrDiario([
      { data: "2024-01-01", valor: "100", fluxo_caixa: "100" },
      { data: "2024-01-02", valor: "110", fluxo_caixa: "0" },
    ]);
    expect(compararComBenchmark(p, [])[1]?.benchmark).toBeCloseTo(100, 6);
  });
});
