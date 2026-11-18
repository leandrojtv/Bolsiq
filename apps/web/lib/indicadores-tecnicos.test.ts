import { describe, expect, it } from "vitest";
import { hojeEmSp, ifr, inicioDoPeriodo, mediaMovel } from "./indicadores-tecnicos";

describe("mediaMovel", () => {
  it("comeca no n-esimo ponto", () => {
    expect(mediaMovel([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
});

describe("ifr", () => {
  it("serie curta nao tem IFR", () => {
    expect(ifr([1, 2, 3], 14).every((v) => v === null)).toBe(true);
  });

  it("so alta da 100, so queda da 0", () => {
    const subindo = Array.from({ length: 20 }, (_, i) => i);
    expect(ifr(subindo, 14).at(-1)).toBe(100);
    const caindo = subindo.map((v) => -v);
    expect(ifr(caindo, 14).at(-1)).toBe(0);
  });

  it("confere com o calculo de Wilder", () => {
    // Serie classica do livro de Wilder (1978), IFR(14) no 15o ponto ~ 70,46.
    const s = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03,
      45.61, 46.28, 46.28, 46.0,
    ];
    const r = ifr(s, 14);
    expect(r[14]).toBeCloseTo(70.46, 1);
    expect(r[15]).toBeCloseTo(66.25, 1);
  });
});

describe("periodos", () => {
  it("conta meses para tras e Max vai ao inicio", () => {
    expect(inicioDoPeriodo("1M", "2026-03-31")).toBe("2026-03-03");
    expect(inicioDoPeriodo("6M", "2026-11-02")).toBe("2026-05-02");
    expect(inicioDoPeriodo("5A", "2026-11-02")).toBe("2021-11-02");
    expect(inicioDoPeriodo("Máx", "2026-11-02")).toBe("1990-01-01");
  });

  it("hoje no fuso de Sao Paulo", () => {
    expect(hojeEmSp(new Date("2026-11-03T02:00:00Z"))).toBe("2026-11-02");
  });
});
