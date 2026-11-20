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

  it("tira CPF; com sufixo de empresa, o nome sai e o sufixo fica", () => {
    expect(anonimizarDescricao("PIX ENVIADO 123.456.789-00 CARLOS")).toBe(
      "PIX ENVIADO [documento] [pessoa]",
    );
    expect(anonimizarDescricao("PIX ENVIADO PADARIA CENTRAL LTDA")).toBe(
      "PIX ENVIADO [pessoa] LTDA",
    );
    // Nome de pessoa junto com empresa nao escapa pelo sufixo.
    expect(anonimizarDescricao("PIX MARIA SOUZA PADARIA LTDA")).toBe("PIX [pessoa] LTDA");
  });

  it("MEI, ME e EIRELI levam o nome do titular: viram [pessoa]", () => {
    expect(anonimizarDescricao("PIX ENVIADO JOAO DA SILVA MEI")).toBe(
      "PIX ENVIADO [pessoa]",
    );
    expect(anonimizarDescricao("TED ANA PAULA EIRELI")).toBe("TED [pessoa]");
  });

  it("nao mexe no que nao e transferencia", () => {
    expect(anonimizarDescricao("iFood *Burger House")).toBe("iFood *Burger House");
    expect(anonimizarDescricao("Supermercado Bom Preço")).toBe("Supermercado Bom Preço");
  });
});
