import { describe, expect, it } from "vitest";
import { eventos } from "@bolsiq/contracts";
import {
  avisoDoEvento,
  preferenciasCompletas,
  TIPOS_FINANCEIROS,
} from "./financas-modelo.js";

const exemplo = (nome: keyof typeof eventos) =>
  eventos[nome].example as Record<string, unknown>;

describe("aviso de cada evento do finance", () => {
  it("fatura vencendo", () => {
    expect(
      avisoDoEvento("finance.fatura.vencendo.v1", exemplo("finance.fatura.vencendo.v1")),
    ).toEqual({
      tipo: "fatura_vencendo",
      user_id: "user-123",
      chave: "fatura_vencendo:5b1e0f4e-2a8c-4d7e-9f00-1c2d3e4f5a6b",
      titulo: "Fatura Nubank vence em 3 dias",
      corpo: "R$ 1.830,45 a pagar até 23/11.",
      link: "/financas/cartoes/c0ffee00-0000-4000-8000-000000000002",
    });
    const hoje = avisoDoEvento("finance.fatura.vencendo.v1", {
      ...exemplo("finance.fatura.vencendo.v1"),
      dias: 0,
    });
    expect(hoje?.titulo).toBe("Fatura Nubank vence hoje");
  });

  it("orcamento em 80% e estourado", () => {
    const a = avisoDoEvento(
      "finance.orcamento.limite.v1",
      exemplo("finance.orcamento.limite.v1"),
    );
    expect(a).toMatchObject({
      tipo: "orcamento_limite",
      titulo: "Orçamento de Restaurantes e delivery em 80%",
      corpo: "R$ 512,30 de R$ 600,00 planejados em novembro de 2026 (85,4%).",
    });
    const b = avisoDoEvento("finance.orcamento.limite.v1", {
      ...exemplo("finance.orcamento.limite.v1"),
      limiar: 100,
    });
    expect(b?.titulo).toBe("Orçamento de Restaurantes e delivery estourado");
  });

  it("saldo negativo e receita atrasada", () => {
    expect(
      avisoDoEvento("finance.saldo.negativo.v1", exemplo("finance.saldo.negativo.v1")),
    ).toMatchObject({
      tipo: "saldo_negativo",
      titulo: "Saldo negativo previsto em dezembro de 2026",
      corpo: "O fluxo projetado termina o mês em R$ -420,10 nas contas.",
    });
    expect(
      avisoDoEvento(
        "finance.receita.atrasada.v1",
        exemplo("finance.receita.atrasada.v1"),
      ),
    ).toMatchObject({
      tipo: "receita_atrasada",
      titulo: "Salario ainda não caiu",
      corpo: "R$ 6.000,00 previstos para 05/11, 2 dias de atraso.",
    });
  });

  it("insight novo: assinatura, reajuste e tarifa viram tipos separados", () => {
    const base = exemplo("finance.insight.novo.v1");
    expect(avisoDoEvento("finance.insight.novo.v1", base)).toMatchObject({
      tipo: "assinatura_nova",
      titulo: "Assinatura nova: NETFLIX",
    });
    expect(
      avisoDoEvento("finance.insight.novo.v1", { ...base, motivo: "reajuste" })?.titulo,
    ).toBe("Reajuste: NETFLIX");
    expect(
      avisoDoEvento("finance.insight.novo.v1", { ...base, motivo: "tarifa_nova" })?.tipo,
    ).toBe("tarifa_nova");
  });

  it("evento que nao e alerta nao vira aviso", () => {
    expect(
      avisoDoEvento(
        "finance.importacao.confirmada.v1",
        exemplo("finance.importacao.confirmada.v1"),
      ),
    ).toBeNull();
  });
});

describe("preferencias por tipo", () => {
  it("tipo ausente vale o padrao: ligado, so no sino", () => {
    const p = preferenciasCompletas({
      saldo_negativo: { ativo: false, canais: ["inapp"] },
    });
    expect(Object.keys(p)).toEqual([...TIPOS_FINANCEIROS]);
    expect(p.saldo_negativo.ativo).toBe(false);
    expect(p.fatura_vencendo).toEqual({ ativo: true, canais: ["inapp"] });
  });

  it("valor invalido no banco volta ao padrao", () => {
    expect(
      preferenciasCompletas({ fatura_vencendo: { ativo: "sim" } }).fatura_vencendo,
    ).toEqual({
      ativo: true,
      canais: ["inapp"],
    });
    expect(preferenciasCompletas(null).reajuste.ativo).toBe(true);
  });
});
