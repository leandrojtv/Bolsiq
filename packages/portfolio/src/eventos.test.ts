import { describe, expect, it } from "vitest";
import { aplicarEvento, fatorDaRazao } from "./eventos.js";

const base = { event_id: "ev-1", ticker: "PETR4", ex_date: "2024-06-10" };

describe("fatorDaRazao", () => {
  it("desdobramento 1:2 multiplica por 2", () => {
    expect(fatorDaRazao("1:2", "desdobramento")?.toNumber()).toBe(2);
  });

  it("grupamento 10:1 guarda o fator 10", () => {
    // A transacao de grupamento divide por ele. Ler na ordem errada inverteria
    // a posicao por um fator de 100 em casos reais.
    expect(fatorDaRazao("10:1", "grupamento")?.toNumber()).toBe(10);
  });

  it("aceita espacos", () => {
    expect(fatorDaRazao(" 1 : 4 ", "desdobramento")?.toNumber()).toBe(4);
  });

  it("recusa razao malformada", () => {
    expect(fatorDaRazao("1-2", "desdobramento")).toBeNull();
    expect(fatorDaRazao("0:2", "desdobramento")).toBeNull();
    expect(fatorDaRazao("1:0", "desdobramento")).toBeNull();
    expect(fatorDaRazao(null, "desdobramento")).toBeNull();
    expect(fatorDaRazao("abc", "desdobramento")).toBeNull();
  });
});

describe("aplicarEvento", () => {
  it("sem posicao na data ex, nenhum evento se aplica", () => {
    const r = aplicarEvento(
      { ...base, kind: "dividendo", value_per_share: "1.00", ratio: null },
      "0",
    );
    expect(r.transacoes).toHaveLength(0);
    expect(r.ignorado).toMatch(/sem posicao/);
  });

  it("dividendo gera provento sobre a quantidade da data ex", () => {
    const r = aplicarEvento(
      { ...base, kind: "dividendo", value_per_share: "1.25", ratio: null },
      "150",
    );
    expect(r.transacoes[0]).toMatchObject({
      tipo: "provento",
      preco: "1.25",
      data: "2024-06-10",
    });
    expect(r.transacoes[0]?.quantidade).toBe("150.00000000");
  });

  it("JCP tambem gera provento", () => {
    const r = aplicarEvento(
      { ...base, kind: "jcp", value_per_share: "0.50", ratio: null },
      "100",
    );
    expect(r.transacoes[0]?.tipo).toBe("provento");
  });

  it("provento sem valor por acao e ignorado, nao gera zero", () => {
    const r = aplicarEvento(
      { ...base, kind: "dividendo", value_per_share: null, ratio: null },
      "100",
    );
    expect(r.transacoes).toHaveLength(0);
    expect(r.ignorado).toMatch(/sem valor/);
  });

  it("desdobramento gera transacao com o fator", () => {
    const r = aplicarEvento(
      { ...base, kind: "desdobramento", value_per_share: null, ratio: "1:2" },
      "90",
    );
    expect(r.transacoes[0]).toMatchObject({ tipo: "desdobramento", preco: "0" });
    expect(Number(r.transacoes[0]?.quantidade)).toBe(2);
  });

  it("grupamento gera o fator a dividir", () => {
    const r = aplicarEvento(
      { ...base, kind: "grupamento", value_per_share: null, ratio: "10:1" },
      "1000",
    );
    expect(r.transacoes[0]?.tipo).toBe("grupamento");
    expect(Number(r.transacoes[0]?.quantidade)).toBe(10);
  });

  it("razao invalida nao gera transacao", () => {
    const r = aplicarEvento(
      { ...base, kind: "desdobramento", value_per_share: null, ratio: "x" },
      "90",
    );
    expect(r.transacoes).toHaveLength(0);
    expect(r.ignorado).toMatch(/razao invalida/);
  });

  it("bonificacao 1:2 acrescenta uma acao por cada existente", () => {
    const r = aplicarEvento(
      { ...base, kind: "bonificacao", value_per_share: "5.00", ratio: "1:2" },
      "100",
    );
    expect(r.transacoes[0]).toMatchObject({ tipo: "bonificacao", preco: "5.00" });
    expect(r.transacoes[0]?.quantidade).toBe("100.00000000");
  });

  it("bonificacao sem preco entra a custo zero", () => {
    const r = aplicarEvento(
      { ...base, kind: "bonificacao", value_per_share: null, ratio: "1:2" },
      "100",
    );
    expect(r.transacoes[0]?.preco).toBe("0");
  });

  it("bonificacao 1:1 nao cria acao nova", () => {
    const r = aplicarEvento(
      { ...base, kind: "bonificacao", value_per_share: null, ratio: "1:1" },
      "100",
    );
    expect(r.transacoes).toHaveLength(0);
    expect(r.ignorado).toMatch(/sem acoes novas/);
  });

  it("bonificacao com razao invalida e ignorada", () => {
    const r = aplicarEvento(
      { ...base, kind: "bonificacao", value_per_share: null, ratio: null },
      "100",
    );
    expect(r.transacoes).toHaveLength(0);
  });
});

describe("ramos restantes", () => {
  it("grupamento com fator que anula nao altera a posicao", () => {
    const r = aplicarEvento(
      { ...base, kind: "grupamento", value_per_share: null, ratio: "1:1" },
      "100",
    );
    expect(Number(r.transacoes[0]?.quantidade)).toBe(1);
  });
});
