import { describe, expect, it } from "vitest";
import { classeDaEspecificacao, classificarCotahist } from "./universo.js";

describe("classificarCotahist", () => {
  it.each([
    ["02", "stock"],
    ["12", "fii"],
    ["14", "etf"],
    ["34", "bdr"],
    ["36", "bdr"],
  ])("CODBDI %s a vista e %s", (codbdi, tipo) => {
    expect(classificarCotahist(codbdi, "010")).toBe(tipo);
  });

  it("deixa de fora opcao, fracionario e outros mercados", () => {
    expect(classificarCotahist("78", "070")).toBeNull();
    expect(classificarCotahist("96", "020")).toBeNull();
    expect(classificarCotahist("02", "020")).toBeNull();
    expect(classificarCotahist("10", "010")).toBeNull();
  });
});

describe("classeDaEspecificacao", () => {
  it("tira o segmento de governanca", () => {
    expect(classeDaEspecificacao("ON      NM")).toBe("ON");
    expect(classeDaEspecificacao(" PN ")).toBe("PN");
    expect(classeDaEspecificacao("")).toBe("");
  });
});
