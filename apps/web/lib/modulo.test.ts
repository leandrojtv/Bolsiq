import { describe, expect, it } from "vitest";
import {
  entradaDoModulo,
  lembrarModulo,
  moduloDoCookie,
  moduloParaLembrar,
} from "./modulo";

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

describe("moduloParaLembrar", () => {
  it("so rota de modulo muda o modulo salvo", () => {
    expect(moduloParaLembrar("/financas/contas")).toBe("financas");
    expect(moduloParaLembrar("/painel")).toBe("painel");
    expect(moduloParaLembrar("/carteiras/abc")).toBe("investimentos");
    expect(moduloParaLembrar("/ativo")).toBe("investimentos");
    expect(moduloParaLembrar("/entrar")).toBeNull();
    expect(moduloParaLembrar("/configuracoes/conta")).toBeNull();
    expect(moduloParaLembrar("/")).toBeNull();
  });
});
