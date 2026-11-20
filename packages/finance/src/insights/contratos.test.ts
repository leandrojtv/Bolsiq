import { describe, expect, it } from "vitest";
import {
  ConfiguracaoDeInsights,
  ParametroDoInsight,
  PedidoDeFeedback,
} from "./contratos.js";

describe("contratos dos insights", () => {
  it("configuracao: limite em pt-BR e referencia somando 100", () => {
    expect(
      ConfiguracaoDeInsights.parse({
        limite_formiga: "30,5",
        referencia: { essenciais: "60", nao_essenciais: 20, poupanca: 20 },
      }),
    ).toEqual({
      limite_formiga: "30.50",
      referencia: { essenciais: 60, nao_essenciais: 20, poupanca: 20 },
    });
    const soma = ConfiguracaoDeInsights.safeParse({
      limite_formiga: "50",
      referencia: { essenciais: 50, nao_essenciais: 30, poupanca: 30 },
    });
    expect(soma.success).toBe(false);
    for (const limite of ["0", "abc", "2000"])
      expect(
        ConfiguracaoDeInsights.safeParse({
          limite_formiga: limite,
          referencia: { essenciais: 50, nao_essenciais: 30, poupanca: 20 },
        }).success,
      ).toBe(false);
  });

  it("id do insight e acao do feedback", () => {
    expect(ParametroDoInsight.safeParse({ id: "assinatura-1u3r14y" }).success).toBe(true);
    expect(ParametroDoInsight.safeParse({ id: "../x" }).success).toBe(false);
    expect(PedidoDeFeedback.safeParse({ acao: "dispensado" }).success).toBe(true);
    expect(PedidoDeFeedback.safeParse({ acao: "apagar" }).success).toBe(false);
  });
});
