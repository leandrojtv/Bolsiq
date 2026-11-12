import { describe, expect, it } from "vitest";
import { ifr, mediaMovel, sinaisTecnicos } from "./tecnicos.js";

describe("mediaMovel e ifr", () => {
  it("media comeca no n-esimo ponto", () => {
    expect(mediaMovel([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("IFR: so alta da 100, so queda da 0", () => {
    const subindo = Array.from({ length: 20 }, (_, i) => i);
    expect(ifr(subindo, 14).at(-1)).toBe(100);
    expect(
      ifr(
        subindo.map((v) => -v),
        14,
      ).at(-1),
    ).toBe(0);
  });
});

describe("sinaisTecnicos", () => {
  const subindo = Array.from({ length: 250 }, (_, i) => 10 + i * 0.1);

  it("alta constante: tendencia de alta e IFR sobrecomprado", () => {
    const t = sinaisTecnicos(subindo);
    expect(t.preco).toBe(34.9);
    expect(t.mm20).toBe(33.95);
    expect(t.mm200).not.toBeNull();
    expect(t.sinais.tendencia?.nivel).toBe("verde");
    expect(t.sinais.curto_prazo?.nivel).toBe("verde");
    expect(t.ifr14).toBe(100);
    expect(t.sinais.ifr?.nivel).toBe("vermelho");
  });

  it("queda constante: tendencia de baixa e IFR sobrevendido", () => {
    const t = sinaisTecnicos([...subindo].reverse());
    expect(t.sinais.tendencia?.nivel).toBe("vermelho");
    expect(t.sinais.curto_prazo?.nivel).toBe("vermelho");
    expect(t.sinais.ifr?.nivel).toBe("verde");
  });

  it("serie curta: sem MM 200 nem tendencia", () => {
    const t = sinaisTecnicos(subindo.slice(0, 60));
    expect(t.mm200).toBeNull();
    expect(t.sinais.tendencia).toBeNull();
    expect(t.sinais.curto_prazo).not.toBeNull();
  });

  it("sem pregao, tudo nulo", () => {
    const t = sinaisTecnicos([]);
    expect(t.preco).toBeNull();
    expect(t.sinais).toEqual({ tendencia: null, curto_prazo: null, ifr: null });
  });
});
