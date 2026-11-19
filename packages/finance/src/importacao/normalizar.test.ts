import { describe, expect, it } from "vitest";
import {
  categorizar,
  ordenarRegras,
  regexValida,
  regraCasa,
  type RegraParaAplicar,
} from "./categorizar.js";
import {
  descricoesParecidas,
  detectarParcela,
  normalizarDeExtrato,
} from "./normalizar.js";

describe("normalizarDeExtrato", () => {
  it.each([
    ["PAG*PADARIA SAO JOAO", "PADARIA SAO JOAO"],
    ["Pag*Padaria São João", "PADARIA SAO JOAO"],
    ["MP *LOJAONLINEEXEMPLO", "LOJAONLINEEXEMPLO"],
    ["IFD*M&M LANCHES", "M M LANCHES"],
    ["Ifd*Restaurante Sabor Caseiro", "RESTAURANTE SABOR CASEIRO"],
    ["PG *TON LANCHONETE DO ZE", "TON LANCHONETE DO ZE"],
    ["EBANX*SPOTIFY", "SPOTIFY"],
    ["PAYPAL *STEAM GAMES", "STEAM GAMES"],
    ["RESTAURANTE BOM PRATO SAO PAULO BR", "RESTAURANTE BOM PRATO"],
    ["POSTO COMBUSTIVEL CENTRO CURITIBA PR", "POSTO COMBUSTIVEL CENTRO"],
    ["PADARIA AÇÚCAR & AFETO BELO HORIZONTE MG", "PADARIA ACUCAR AFETO"],
    ["SUPERMERCADO EXEMPLO COMPRA AUT 482913", "SUPERMERCADO EXEMPLO COMPRA"],
    ["LOJA MAGAZINE EXEMPLO PARC 03/10", "LOJA MAGAZINE EXEMPLO"],
    ["Loja de Eletronicos - Parcela 2/6", "LOJA DE ELETRONICOS"],
    ["ACADEMIA EXEMPLO 3 DE 10", "ACADEMIA EXEMPLO"],
    ["CLINICA EXEMPLO 04/05", "CLINICA EXEMPLO"],
    ["PIX ENVIADO 12345678901 FULANO", "PIX ENVIADO FULANO"],
    ["Pix - FULANO - •••.123.456-•• - BANCO", "PIX FULANO BANCO"],
    ["SP", "SP"],
    ["***", "***"],
  ])("%s -> %s", (entrada, saida) => {
    expect(normalizarDeExtrato(entrada)).toBe(saida);
  });
});

describe("detectarParcela", () => {
  it.each([
    ["LOJA PARC 03/10", { atual: 3, total: 10 }],
    ["LOJA PARCELA 3 DE 10", { atual: 3, total: 10 }],
    ["Loja - Parcela 2/6", { atual: 2, total: 6 }],
    ["ACADEMIA 3 DE 10", { atual: 3, total: 10 }],
    ["CLINICA 04/05", { atual: 4, total: 5 }],
    ["LOJA 11/10", null],
    ["LOJA 1/1", null],
    ["PADARIA", null],
  ])("%s", (t, esperado) => {
    expect(detectarParcela(t)).toEqual(esperado);
  });
});

describe("descricoesParecidas", () => {
  it("contem, palavras em comum e diferentes", () => {
    expect(descricoesParecidas("Padaria", "PAG*PADARIA SAO JOAO")).toBe(true);
    expect(descricoesParecidas("Mercado Bom Preço", "MERCADO PRECO BOM CENTRO")).toBe(
      true,
    );
    expect(descricoesParecidas("Uber", "Netflix")).toBe(false);
    expect(descricoesParecidas("AB CD", "EF GH")).toBe(false);
    expect(descricoesParecidas("", "x")).toBe(false);
  });
});

describe("regras de categorizacao", () => {
  const regra = (r: Partial<RegraParaAplicar>): RegraParaAplicar => ({
    id: "r",
    padrao: "padaria",
    modo: "contem",
    category_id: "mercado",
    prioridade: 100,
    origem: "usuario",
    ...r,
  });

  it("contem, comeca_com e regex sobre a descricao normalizada", () => {
    expect(regraCasa(regra({}), "PADARIA SAO JOAO")).toBe(true);
    expect(regraCasa(regra({ padrao: "Pão" }), "PAO QUENTE")).toBe(true);
    expect(regraCasa(regra({ modo: "comeca_com", padrao: "sao" }), "PADARIA SAO")).toBe(
      false,
    );
    expect(regraCasa(regra({ modo: "comeca_com" }), "PADARIA SAO")).toBe(true);
    expect(regraCasa(regra({ modo: "regex", padrao: "^uber" }), "UBER TRIP")).toBe(true);
    expect(regraCasa(regra({ modo: "regex", padrao: "(" }), "UBER")).toBe(false);
    expect(regraCasa(regra({ padrao: "***" }), "X")).toBe(false);
    expect(regexValida("(")).toBe(false);
    expect(regexValida("^a+$")).toBe(true);
  });

  it("usuario antes de aprendida, depois prioridade", () => {
    const ordem = ordenarRegras([
      regra({ id: "a", origem: "aprendida", prioridade: 1 }),
      regra({ id: "b", prioridade: 50 }),
      regra({ id: "c", prioridade: 10 }),
      regra({ id: "d", prioridade: 10 }),
    ]).map((r) => r.id);
    expect(ordem).toEqual(["c", "d", "b", "a"]);
  });

  it("regra, depois historico, depois nada; respeita a natureza", () => {
    const natureza = (id: string) =>
      ({ mercado: "despesa", salario: "receita", lazer: "despesa" })[id];
    const regras = ordenarRegras([
      regra({ id: "r1", padrao: "padaria", category_id: "salario" }),
      regra({ id: "r2", padrao: "padaria", category_id: "mercado", prioridade: 200 }),
    ]);
    const hist = new Map([
      ["despesa|CINEMA CENTRO", "lazer"],
      ["despesa|BAR", "salario"],
    ]);
    expect(categorizar("PADARIA X", "despesa", regras, hist, natureza)).toEqual({
      category_id: "mercado",
      origem: "regra",
      regra_id: "r2",
    });
    expect(categorizar("CINEMA CENTRO", "despesa", regras, hist, natureza)).toEqual({
      category_id: "lazer",
      origem: "historico",
      regra_id: null,
    });
    expect(categorizar("BAR", "despesa", regras, hist, natureza).origem).toBe("nenhuma");
    expect(categorizar("NADA", "receita", regras, hist, natureza)).toEqual({
      category_id: null,
      origem: "nenhuma",
      regra_id: null,
    });
  });
});
