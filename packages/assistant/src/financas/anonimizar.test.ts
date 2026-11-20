import { describe, expect, it } from "vitest";
import { anonimizarDescricao } from "./anonimizar.js";

describe("anonimizarDescricao", () => {
  it("troca o nome da pessoa em PIX e transferencia por um marcador", () => {
    expect(anonimizarDescricao("PIX ENVIADO JOAO DA SILVA")).toBe("PIX ENVIADO [pessoa]");
    expect(anonimizarDescricao("Pix recebido - Maria José de Souza")).toBe(
      "Pix recebido - [pessoa]",
    );
    expect(anonimizarDescricao("TED 001 0001 Ana Paula")).toBe("TED 001 0001 [pessoa]");
    expect(anonimizarDescricao("TRANSF ENTRE CONTAS")).toBe("TRANSF ENTRE CONTAS");
  });

  it("tira CPF e mantem empresa", () => {
    expect(anonimizarDescricao("PIX ENVIADO 123.456.789-00 CARLOS")).toBe(
      "PIX ENVIADO [documento] [pessoa]",
    );
    expect(anonimizarDescricao("PIX ENVIADO PADARIA CENTRAL LTDA")).toBe(
      "PIX ENVIADO PADARIA CENTRAL LTDA",
    );
  });

  it("nao mexe no que nao e transferencia", () => {
    expect(anonimizarDescricao("iFood *Burger House")).toBe("iFood *Burger House");
    expect(anonimizarDescricao("Supermercado Bom Preço")).toBe("Supermercado Bom Preço");
  });
});
