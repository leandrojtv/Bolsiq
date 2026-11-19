import { describe, expect, it } from "vitest";
import { entradaDoModulo, lembrarModulo, moduloDoCookie } from "./modulo";

describe("modulo do cookie", () => {
  it("le o modulo salvo e cai em investimentos sem ele", () => {
    expect(moduloDoCookie("a=1; bolsiq_modulo=financas; b=2")).toBe("financas");
    expect(moduloDoCookie("bolsiq_modulo=outro")).toBe("investimentos");
    expect(moduloDoCookie("")).toBe("investimentos");
  });
  it("entrada de cada modulo", () => {
    expect(entradaDoModulo("financas")).toBe("/financas");
    expect(entradaDoModulo("painel")).toBe("/painel");
    expect(entradaDoModulo("investimentos")).toBe("/carteiras");
  });
  it("lembrar grava o cookie", () => {
    lembrarModulo("painel");
    expect(moduloDoCookie(document.cookie)).toBe("painel");
  });
});
