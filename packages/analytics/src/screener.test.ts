import { describe, expect, it } from "vitest";
import { Faixa, FiltroDeScreener, filtroDoPreset, presets } from "./screener.js";

describe("Faixa", () => {
  it("aceita min, max ou os dois", () => {
    expect(Faixa.parse({ min: 1 })).toEqual({ min: 1 });
    expect(Faixa.parse({ max: 10 })).toEqual({ max: 10 });
    expect(Faixa.parse({ min: 1, max: 10 })).toEqual({ min: 1, max: 10 });
  });

  it("recusa faixa vazia", () => {
    expect(() => Faixa.parse({})).toThrow();
  });

  it("recusa min acima de max", () => {
    expect(() => Faixa.parse({ min: 10, max: 1 })).toThrow(/min nao pode/);
  });
});

describe("FiltroDeScreener", () => {
  it("aplica os padroes", () => {
    const f = FiltroDeScreener.parse({});
    expect(f).toMatchObject({
      faixas: {},
      ordenar_por: "pl",
      ordem: "asc",
      incluir_indefinidos: false,
      limite: 100,
      deslocamento: 0,
    });
  });

  it("recusa indicador fora da lista", () => {
    expect(() => FiltroDeScreener.parse({ faixas: { inventado: { min: 1 } } })).toThrow();
    expect(() => FiltroDeScreener.parse({ ordenar_por: "inventado" })).toThrow();
  });

  it("limita o tamanho da pagina", () => {
    expect(() => FiltroDeScreener.parse({ limite: 5000 })).toThrow();
    expect(() => FiltroDeScreener.parse({ limite: 0 })).toThrow();
  });

  it("aceita cinco filtros combinados", () => {
    const f = FiltroDeScreener.parse({
      faixas: {
        pl: { min: 0, max: 15 },
        pvp: { max: 2 },
        roe: { min: 0.15 },
        dl_ebitda: { max: 3 },
        dy_12m: { min: 0.05 },
      },
      setores: ["Petroleo e Gas"],
      tipos: ["stock"],
      liquidez_minima: 5_000_000,
    });
    expect(Object.keys(f.faixas)).toHaveLength(5);
  });

  it("recusa liquidez negativa", () => {
    expect(() => FiltroDeScreener.parse({ liquidez_minima: -1 })).toThrow();
  });
});

describe("presets", () => {
  it("todo preset tem descricao e filtro valido", () => {
    for (const [nome, p] of Object.entries(presets)) {
      expect(p.descricao.length, nome).toBeGreaterThan(20);
      expect(() => filtroDoPreset(nome as keyof typeof presets), nome).not.toThrow();
    }
  });

  it("Graham exige desconto e limita P/L e P/VP", () => {
    const f = filtroDoPreset("graham");
    expect(f.faixas.margem_graham).toEqual({ min: 0.2 });
    expect(f.faixas.pl).toEqual({ min: 0, max: 15 });
    expect(f.faixas.pvp).toEqual({ min: 0, max: 1.5 });
  });

  it("Bazin pede 6% de dividendo medio, a taxa do metodo", () => {
    expect(filtroDoPreset("bazin").faixas.dy_medio_5a).toEqual({ min: 0.06 });
  });

  it("Magic Formula combina EV/EBIT baixo com ROIC alto", () => {
    const f = filtroDoPreset("magic_formula");
    expect(f.faixas.ev_ebit?.max).toBe(12);
    expect(f.faixas.roic?.min).toBe(0.15);
  });

  it("nenhum preset inclui indefinidos", () => {
    // Empresa sem lucro no topo de uma ordenacao por P/L crescente seria o
    // pior resultado possivel de um screener.
    for (const nome of Object.keys(presets)) {
      expect(filtroDoPreset(nome as keyof typeof presets).incluir_indefinidos).toBe(
        false,
      );
    }
  });
});

describe("rotulos", () => {
  it("todo indicador filtravel tem rotulo e todo preset tem nome", async () => {
    const { INDICADORES, NOME_DO_PRESET, IndicadorFiltravel, presets } =
      await import("./screener.js");
    expect(Object.keys(INDICADORES).sort()).toEqual(
      [...IndicadorFiltravel.options].sort(),
    );
    expect(Object.keys(NOME_DO_PRESET).sort()).toEqual(Object.keys(presets).sort());
  });
});
