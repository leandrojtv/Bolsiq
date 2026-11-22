import { describe, expect, it } from "vitest";
import {
  NovaMeta,
  NovoEmprestimo,
  NovoParcelamentoNoCartao,
  ParametroDoFluxo,
  ResultadoDaExclusao,
} from "./contratos-parcelamento.js";

describe("contratos de parcelamento, divida, meta e fluxo", () => {
  it("parcela ou total, nunca os dois", () => {
    const base = { card_id: "c", descricao: "TV", data: "2024-11-20", n_parcelas: "10" };
    expect(
      NovoParcelamentoNoCartao.parse({ ...base, valor_parcela: "120" }),
    ).toMatchObject({
      n_parcelas: 10,
      valor_parcela: "120",
    });
    expect(NovoParcelamentoNoCartao.safeParse(base).success).toBe(false);
    expect(
      NovoParcelamentoNoCartao.safeParse({
        ...base,
        valor_parcela: "1",
        valor_total: "10",
      }).success,
    ).toBe(false);
    expect(
      NovoParcelamentoNoCartao.safeParse({ ...base, n_parcelas: 1, valor_total: "1" })
        .success,
    ).toBe(false);
  });
  it("taxa em % ao mes vira fracao", () => {
    const e = {
      origem: "financiamento",
      account_id: "a",
      descricao: "Carro",
      valor_financiado: "50.000",
      n_parcelas: 48,
      sistema: "sac",
      primeira_data: "2025-01-10",
    };
    expect(NovoEmprestimo.parse({ ...e, taxa_mensal: "1,5" }).taxa_mensal).toBe("0.015");
    expect(NovoEmprestimo.parse({ ...e, taxa_mensal: "0" }).taxa_mensal).toBe("0");
    expect(NovoEmprestimo.safeParse({ ...e, taxa_mensal: "abc" }).success).toBe(false);
    expect(NovoEmprestimo.safeParse({ ...e, taxa_mensal: "150" }).success).toBe(false);
  });
  it("meta e fluxo", () => {
    expect(
      NovaMeta.parse({
        nome: "Casa",
        valor_alvo: "100.000",
        data_alvo: "2030-01-01",
        account_id: "",
      }),
    ).toMatchObject({ valor_alvo: "100000", account_id: null, ativa: true });
    expect(ParametroDoFluxo.parse({})).toEqual({ meses: 6 });
    expect(ParametroDoFluxo.safeParse({ meses: "13" }).success).toBe(false);
  });

  it("resultado da exclusao: contagens inteiras e nao negativas", () => {
    expect(
      ResultadoDaExclusao.parse({ previstas_apagadas: 10, realizados_desvinculados: 2 }),
    ).toEqual({ previstas_apagadas: 10, realizados_desvinculados: 2 });
    expect(
      ResultadoDaExclusao.safeParse({
        previstas_apagadas: -1,
        realizados_desvinculados: 0,
      }).success,
    ).toBe(false);
    expect(
      ResultadoDaExclusao.safeParse({
        previstas_apagadas: 1.5,
        realizados_desvinculados: 0,
      }).success,
    ).toBe(false);
  });
});
