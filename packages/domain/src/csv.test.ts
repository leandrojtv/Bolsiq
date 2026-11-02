import { describe, expect, it } from "vitest";
import { dividirLinhaCsv, leitorDeColunas } from "./csv.js";

describe("dividirLinhaCsv", () => {
  it("divide por ponto e virgula", () => {
    expect(dividirLinhaCsv("a;b;;c")).toEqual(["a", "b", "", "c"]);
  });

  it("respeita aspas com separador e aspas escapadas dentro", () => {
    expect(dividirLinhaCsv('1;"Cia; S.A.";"diz ""oi"""')).toEqual([
      "1",
      "Cia; S.A.",
      'diz "oi"',
    ]);
  });
});

describe("leitorDeColunas", () => {
  it("le por nome, ignorando BOM e espacos", () => {
    const ler = leitorDeColunas("\uFEFFCNPJ_CIA;CD_CVM");
    const campo = ler(" 33.000.167/0001-01 ;009512");
    expect(campo("CNPJ_CIA")).toBe("33.000.167/0001-01");
    expect(campo("CD_CVM")).toBe("009512");
  });

  it("falha alto em coluna inexistente e informa quais existem", () => {
    const ler = leitorDeColunas("A;B");
    expect(() => ler("1;2")("C")).toThrow(/coluna ausente/);
    expect(ler.tem("A")).toBe(true);
    expect(ler.tem("C")).toBe(false);
  });

  it("devolve vazio quando a linha e mais curta que o cabecalho", () => {
    expect(leitorDeColunas("A;B")("1")("B")).toBe("");
  });
});
