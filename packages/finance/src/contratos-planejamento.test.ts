import { describe, expect, it } from "vitest";
import {
  EdicaoDeItemDoPlanejamento,
  EdicaoDeRecorrencia,
  NovaRecorrencia,
  NovoItemDoPlanejamento,
  PagamentoDeFatura,
} from "./contratos-planejamento.js";

const base = {
  tipo: "despesa",
  descricao: "Aluguel",
  valor: "1.800,00",
  account_id: "a",
  dia: "10",
  inicio: "2024-01-01",
};

describe("NovaRecorrencia", () => {
  it("normaliza valor e dia, mensal por padrao", () => {
    expect(NovaRecorrencia.parse({ ...base, fim: "", category_id: "" })).toMatchObject({
      valor: "1800.00",
      dia: 10,
      frequencia: "mensal",
      fim: null,
      category_id: null,
      valor_variavel: false,
      ativa: true,
    });
  });
  it("conta ou cartao; cartao so despesa; semanal ate 7; fim depois do inicio", () => {
    const msg = (x: unknown) => NovaRecorrencia.safeParse(x).error?.issues[0]?.message;
    expect(msg({ ...base, account_id: undefined })).toBe("escolha a conta ou o cartão");
    expect(msg({ ...base, account_id: undefined, card_id: "c", tipo: "receita" })).toBe(
      "no cartão, só despesa",
    );
    expect(msg({ ...base, frequencia: "semanal", dia: 8 })).toMatch(/1 \(segunda\) a 7/);
    expect(msg({ ...base, fim: "2023-12-31" })).toBe("fim antes do início");
    expect(msg({ ...base, valor: "0" })).toBe("valor inválido");
  });
  it("edicao parcial valida as mesmas regras", () => {
    expect(EdicaoDeRecorrencia.parse({ valor: "99,9" })).toEqual({ valor: "99.9" });
    expect(EdicaoDeRecorrencia.safeParse({ frequencia: "semanal", dia: 9 }).success).toBe(
      false,
    );
  });
});

describe("planejamento e pagamento", () => {
  it("item aceita valor zero e descricao vazia vira nula", () => {
    expect(
      NovoItemDoPlanejamento.parse({
        mes: "2024-03",
        category_id: "c",
        valor: "0",
        descricao: " ",
      }),
    ).toEqual({
      mes: "2024-03",
      category_id: "c",
      valor: "0",
      descricao: null,
      fixo: false,
    });
    expect(
      NovoItemDoPlanejamento.safeParse({ mes: "03/2024", category_id: "c", valor: "1" })
        .success,
    ).toBe(false);
  });
  it("item dividido aceita percentual entre 0 e 100, exclusivos", () => {
    const base = { mes: "2024-03", category_id: "c", valor: "3000" };
    expect(
      NovoItemDoPlanejamento.parse({ ...base, parte_propria: "50" }).parte_propria,
    ).toBe(50);
    expect(
      NovoItemDoPlanejamento.parse({ ...base, parte_propria: "33,33" }).parte_propria,
    ).toBe(33.33);
    expect(
      NovoItemDoPlanejamento.parse({ ...base, parte_propria: "" }).parte_propria,
    ).toBe(null);
    for (const parte of ["0", "100", "-5", "abc", "10.555"])
      expect(
        NovoItemDoPlanejamento.safeParse({ ...base, parte_propria: parte }).success,
        parte,
      ).toBe(false);
    expect(EdicaoDeItemDoPlanejamento.parse({ parte_propria: null })).toEqual({
      parte_propria: null,
    });
  });
  it("pagamento com valor opcional", () => {
    expect(PagamentoDeFatura.parse({ data: "2024-03-10" })).toEqual({
      data: "2024-03-10",
    });
    expect(PagamentoDeFatura.safeParse({ data: "2024-03-10", valor: "-1" }).success).toBe(
      false,
    );
  });
});
