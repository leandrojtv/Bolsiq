import { describe, expect, it } from "vitest";
import { CATEGORIAS_PADRAO } from "./categorias-padrao.js";
import {
  EdicaoDeLancamento,
  FiltroDeLancamentos,
  NovaCategoria,
  NovaConta,
  NovoLancamento,
} from "./contratos.js";
import { valorDigitado } from "./decimal.js";

describe("valorDigitado", () => {
  it("aceita pt-BR e ponto decimal", () => {
    expect(valorDigitado("45,90")).toBe("45.90");
    expect(valorDigitado("1.234,5")).toBe("1234.5");
    expect(valorDigitado("R$ 10")).toBe("10");
    expect(valorDigitado("12.34")).toBe("12.34");
  });
  it("recusa lixo e mais de duas casas", () => {
    expect(valorDigitado("abc")).toBeNull();
    expect(valorDigitado("1,234")).toBeNull();
  });
});

describe("NovaConta", () => {
  it("aceita saldo negativo e instituicao vazia", () => {
    const r = NovaConta.parse({
      nome: " Nubank ",
      tipo: "corrente",
      instituicao: "",
      saldo_inicial: "-150,30",
      data_saldo_inicial: "2026-03-01",
    });
    expect(r).toMatchObject({
      nome: "Nubank",
      instituicao: null,
      saldo_inicial: "-150.30",
    });
  });
  it("saldo padrao e zero e -0 vira 0", () => {
    const base = { nome: "X", tipo: "carteira", data_saldo_inicial: "2026-03-01" };
    expect(NovaConta.parse(base).saldo_inicial).toBe("0");
    expect(NovaConta.parse({ ...base, saldo_inicial: "-0" }).saldo_inicial).toBe("0");
  });
  it("recusa tipo e saldo invalidos", () => {
    expect(
      NovaConta.safeParse({ nome: "X", tipo: "cartao", data_saldo_inicial: "2026-03-01" })
        .success,
    ).toBe(false);
    const r = NovaConta.safeParse({
      nome: "X",
      tipo: "corrente",
      saldo_inicial: "dez",
      data_saldo_inicial: "2026-03-01",
    });
    expect(r.success).toBe(false);
  });
});

describe("NovoLancamento", () => {
  const base = {
    tipo: "despesa",
    valor: "45,90",
    data: "2026-03-10",
    descricao: "Padaria",
    account_id: "a",
  };
  it("normaliza valor e usa realizado por padrao", () => {
    expect(NovoLancamento.parse(base)).toMatchObject({
      valor: "45.90",
      status: "realizado",
    });
  });
  it("recusa valor zero", () => {
    expect(NovoLancamento.safeParse({ ...base, valor: "0" }).success).toBe(false);
  });
  it("transferencia exige destino diferente da origem", () => {
    const t = { ...base, tipo: "transferencia" };
    expect(NovoLancamento.safeParse(t).error?.issues[0]?.message).toBe(
      "escolha a conta de destino",
    );
    expect(
      NovoLancamento.safeParse({ ...t, conta_destino_id: "a" }).error?.issues[0]?.message,
    ).toBe("origem e destino iguais");
    expect(NovoLancamento.safeParse({ ...t, conta_destino_id: "b" }).success).toBe(true);
  });
  it("edicao parcial", () => {
    expect(EdicaoDeLancamento.parse({ valor: "1,5", observacao: "" })).toEqual({
      valor: "1.5",
      observacao: null,
    });
  });
});

describe("NovaCategoria e filtro", () => {
  it("categoria com padroes", () => {
    expect(NovaCategoria.parse({ nome: "Feira", natureza: "despesa" })).toMatchObject({
      tipo_custo: "variavel",
      essencial: false,
    });
  });
  it("filtro converte paginacao e limita o tamanho", () => {
    expect(FiltroDeLancamentos.parse({ pagina: "2" })).toMatchObject({
      pagina: 2,
      por_pagina: 50,
    });
    expect(FiltroDeLancamentos.safeParse({ por_pagina: "500" }).success).toBe(false);
  });
});

describe("categorias padrao", () => {
  it("tem as de sistema que os insights usam e nomes unicos", () => {
    const sistema = CATEGORIAS_PADRAO.filter((c) => c.sistema).map((c) => c.nome);
    expect(sistema).toEqual(["Tarifas bancárias", "Juros e encargos", "IOF"]);
    const nomes = CATEGORIAS_PADRAO.map((c) => c.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
    expect(nomes).toHaveLength(24);
  });
});
