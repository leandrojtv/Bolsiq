import { describe, expect, it } from "vitest";
import {
  EdicaoDeLinha,
  EdicaoDeRegra,
  NovaImportacao,
  NovaRegra,
  NovoCartao,
} from "./contratos-importacao.js";

describe("NovoCartao", () => {
  it("dias de 1 a 31, final com 4 digitos, limite em pt-BR", () => {
    expect(
      NovoCartao.parse({
        nome: "Roxinho",
        dia_fechamento: "3",
        dia_vencimento: 10,
        final: "",
        limite: "5.000,00",
        instituicao: "",
      }),
    ).toMatchObject({
      dia_fechamento: 3,
      final: null,
      limite: "5000.00",
      instituicao: null,
    });
    expect(
      NovoCartao.safeParse({ nome: "x", dia_fechamento: 32, dia_vencimento: 1 }).success,
    ).toBe(false);
    expect(
      NovoCartao.safeParse({
        nome: "x",
        dia_fechamento: 1,
        dia_vencimento: 1,
        final: "12",
      }).success,
    ).toBe(false);
    expect(
      NovoCartao.safeParse({
        nome: "x",
        dia_fechamento: 1,
        dia_vencimento: 1,
        limite: "abc",
      }).success,
    ).toBe(false);
    expect(
      NovoCartao.parse({ nome: "x", dia_fechamento: 1, dia_vencimento: 1, limite: "" })
        .limite,
    ).toBeNull();
  });
});

describe("NovaImportacao", () => {
  it("conta exige account_id; cartao exige cartao e vencimento", () => {
    expect(NovaImportacao.safeParse({ alvo: "conta" }).error?.issues[0]?.message).toBe(
      "escolha a conta",
    );
    expect(NovaImportacao.safeParse({ alvo: "conta", account_id: "a" }).success).toBe(
      true,
    );
    expect(NovaImportacao.safeParse({ alvo: "cartao", card_id: "c" }).success).toBe(
      false,
    );
    expect(
      NovaImportacao.safeParse({ alvo: "cartao", card_id: "c", vencimento: "2023-12-10" })
        .success,
    ).toBe(true);
  });
});

describe("EdicaoDeLinha", () => {
  it("divisao em exatamente duas partes; transferencia para conta ou cartao", () => {
    expect(
      EdicaoDeLinha.safeParse({ divisoes: [{ category_id: "a", valor: "1" }] }).success,
    ).toBe(false);
    expect(
      EdicaoDeLinha.safeParse({
        transferencia_conta_id: "a",
        transferencia_cartao_id: "b",
      }).success,
    ).toBe(false);
    expect(EdicaoDeLinha.parse({ category_id: "x", aplicar_a_iguais: true })).toEqual({
      category_id: "x",
      aplicar_a_iguais: true,
    });
  });
});

describe("regras", () => {
  it("modo padrao contem, prioridade 100, regex validada", () => {
    expect(NovaRegra.parse({ padrao: "padaria", category_id: "c" })).toMatchObject({
      modo: "contem",
      prioridade: 100,
    });
    expect(
      NovaRegra.safeParse({ padrao: "(abc", modo: "regex", category_id: "c" }).error
        ?.issues[0]?.message,
    ).toBe("expressão regular inválida");
    expect(EdicaoDeRegra.safeParse({ prioridade: "5" }).success).toBe(true);
    expect(EdicaoDeRegra.safeParse({ modo: "regex", padrao: "[" }).success).toBe(false);
  });
});
