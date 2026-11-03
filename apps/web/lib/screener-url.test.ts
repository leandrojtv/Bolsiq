import { describe, expect, it } from "vitest";
import {
  estadoDaUrl,
  estadoDoPreset,
  estadoInicial,
  filtroDoEstado,
  urlDoEstado,
} from "./screener-url";

describe("estado do screener na URL", () => {
  it("ida e volta preserva o estado", () => {
    const e = {
      ...estadoDoPreset("graham"),
      liquidezMinima: 1_000_000,
      incluirIndefinidos: true,
      pagina: 3,
    };
    expect(estadoDaUrl(new URLSearchParams(urlDoEstado(e)))).toEqual(e);
  });

  it("preset sozinho na URL aplica as faixas do autor", () => {
    const e = estadoDaUrl(new URLSearchParams("preset=graham"));
    expect(e.faixas).toEqual({
      margem_graham: { min: 0.2 },
      pl: { min: 0, max: 15 },
      pvp: { min: 0, max: 1.5 },
    });
    expect(e.ordenarPor).toBe("margem_graham");
    expect(e.ordem).toBe("desc");
    expect(e.tipos).toEqual(["stock"]);
  });

  it("f na URL substitui as faixas do preset; lado vazio e sem limite", () => {
    const e = estadoDaUrl(
      new URLSearchParams("preset=graham&f=pl::12;roe:0.15:;xpto:1:2;pvp::"),
    );
    expect(e.faixas).toEqual({ pl: { max: 12 }, roe: { min: 0.15 } });
  });

  it("valores invalidos caem no padrao", () => {
    const e = estadoDaUrl(
      new URLSearchParams("preset=nada&tipos=xx&ord=zz&dir=x&pag=-3&cols=a,b"),
    );
    expect(e).toEqual(estadoInicial());
  });

  it("filtro do POST com pagina e liquidez", () => {
    const f = filtroDoEstado(
      { ...estadoInicial(), pagina: 2, liquidezMinima: 500_000 },
      50,
    );
    expect(f).toMatchObject({
      limite: 50,
      deslocamento: 50,
      liquidez_minima: 500_000,
      tipos: ["stock"],
    });
    expect(filtroDoEstado(estadoInicial())).not.toHaveProperty("liquidez_minima");
  });
});
