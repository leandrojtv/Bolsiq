import { describe, expect, it } from "vitest";
import { fontesDeTeste, HOJE } from "../../eval/base.js";
import { fontesFinanceirasDeTeste } from "../../eval/base-financas.js";
import { NOMES_DAS_FERRAMENTAS } from "../ferramentas.js";
import { ferramentasDoModulo, moduloDoCaminho } from "../modulos.js";
import { montarSistema } from "../prompt.js";
import {
  criarFerramentasFinanceiras,
  intervaloDoMes,
  mesesAnteriores,
  NOMES_DAS_FERRAMENTAS_FINANCEIRAS,
} from "./ferramentas.js";
import type { FontesFinanceiras } from "./tipos.js";

type Saida = Record<string, unknown>;

function chamar(
  f: ReturnType<typeof criarFerramentasFinanceiras>,
  nome: string,
  entrada: unknown,
) {
  const t = f[nome] as unknown as {
    inputSchema: { parse: (v: unknown) => unknown };
    execute: (e: unknown, o: unknown) => Promise<Saida>;
  };
  return t.execute(t.inputSchema.parse(entrada), {});
}

const f = criarFerramentasFinanceiras(fontesFinanceirasDeTeste(), { hoje: HOJE });

describe("ferramentas financeiras", () => {
  it("existem todas", () => {
    expect(Object.keys(f).sort()).toEqual([...NOMES_DAS_FERRAMENTAS_FINANCEIRAS].sort());
  });

  it.each([
    ["resumo_mes", {}],
    ["gastos_por_categoria", {}],
    ["comparar_meses", { a: "2026-09", b: "2026-10" }],
    ["listar_lancamentos", { busca: "ifood" }],
    ["fluxo_projetado", {}],
    ["parcelas_futuras", {}],
    ["assinaturas", {}],
    ["insights", {}],
    ["sugerir_cortes", { meta_mensal: 500 }],
    ["simular_compra", { valor: 4000, parcelas: 10 }],
    ["capacidade_aporte", {}],
  ])("%s devolve proveniencia", async (nome, entrada) => {
    const s = await chamar(f, nome, entrada);
    expect(s.erro).toBeUndefined();
    expect(s.proveniencia).toHaveLength(1);
  });

  it("resumo do mes atual por padrao, com link", async () => {
    const s = await chamar(f, "resumo_mes", {});
    expect(s).toMatchObject({ competencia: "2026-10", link: "/financas?mes=2026-10" });
  });

  it("listar: mes ganha de de/ate; periodo invalido vira erro", async () => {
    const out = await chamar(f, "listar_lancamentos", { mes: "2026-10", busca: "ifood" });
    expect(out).toMatchObject({
      periodo: { de: "2026-10-01", ate: "2026-10-31" },
      soma_despesas: "146.40",
    });
    const padrao = await chamar(f, "listar_lancamentos", { busca: "ifood" });
    expect(padrao.periodo).toEqual({ de: "2026-08-01", ate: "2026-10-30" });
    expect(padrao.soma_despesas).toBe("239.70");
    const errado = await chamar(f, "gastos_por_categoria", {
      de: "2026-10-10",
      ate: "2026-10-01",
    });
    expect(errado.erro).toBe("periodo_invalido");
    const longo = await chamar(f, "listar_lancamentos", {
      de: "2025-01-01",
      ate: "2026-10-01",
    });
    expect(longo.erro).toBe("periodo_invalido");
  });

  it("gastos de um periodo e comparacao", async () => {
    const g = await chamar(f, "gastos_por_categoria", {
      de: "2026-09-01",
      ate: "2026-10-31",
      top: 1,
    });
    expect(g).toMatchObject({ total: "8689.30", categorias: [{ categoria: "Moradia" }] });
    const c = await chamar(f, "comparar_meses", { a: "2026-09", b: "2026-10" });
    expect(c.variacao).toBe("273.10");
  });

  it("insights filtra por tipo; cortes e compra usam os calculos", async () => {
    const i = await chamar(f, "insights", { tipo: "assinatura" });
    expect((i.insights as unknown[]).length).toBe(2);
    const c = await chamar(f, "sugerir_cortes", { meta_mensal: 100 });
    expect(c.economia_mensal).toBe("118.10");
    const s = await chamar(f, "simular_compra", { valor: 4000, parcelas: 10 });
    expect(s).toMatchObject({ veredito: "cabe", valor_da_parcela: "400.00" });
    expect((s.meses as unknown[]).length).toBe(11);
    const curta = await chamar(f, "simular_compra", { valor: 100 });
    expect((curta.meses as unknown[]).length).toBe(6);
  });

  it("capacidade de aporte usa os 3 meses completos anteriores", async () => {
    const s = await chamar(f, "capacidade_aporte", {});
    expect(s).toMatchObject({
      meses_de_referencia: ["2026-07", "2026-08", "2026-09"],
      capacidade_mensal: "3319.10",
    });
  });

  it("parcelas e assinaturas resumidas", async () => {
    const p = await chamar(f, "parcelas_futuras", {});
    expect(p).toMatchObject({ planos_omitidos: 0, link: "/financas/parcelamentos" });
    const a = await chamar(f, "assinaturas", {});
    expect(a.total_mensal).toBe("44.90");
  });

  it("fonte que falha vira erro que o modelo le", async () => {
    const quebrada: FontesFinanceiras = {
      ...fontesFinanceirasDeTeste(),
      fluxo: () => Promise.reject(new Error("caiu")),
    };
    const s = await chamar(
      criarFerramentasFinanceiras(quebrada, { hoje: HOJE }),
      "fluxo_projetado",
      {},
    );
    expect(s.erro).toBe("indisponivel");
  });

  it("datas auxiliares", () => {
    expect(intervaloDoMes("2026-02")).toEqual({ de: "2026-02-01", ate: "2026-02-28" });
    expect(mesesAnteriores("2026-01-15", 3)).toEqual(["2025-10", "2025-11", "2025-12"]);
  });
});

describe("contexto por modulo", () => {
  const fontes = {
    fontes: fontesDeTeste(),
    financas: fontesFinanceirasDeTeste(),
    opcoes: { hoje: HOJE, modo: "personal" as const },
  };

  it("financas so com as financeiras; investimentos como antes; painel com as duas", () => {
    expect(Object.keys(ferramentasDoModulo("financas", fontes)).sort()).toEqual(
      [...NOMES_DAS_FERRAMENTAS_FINANCEIRAS].sort(),
    );
    expect(Object.keys(ferramentasDoModulo("investimentos", fontes)).sort()).toEqual(
      [...NOMES_DAS_FERRAMENTAS].sort(),
    );
    expect(Object.keys(ferramentasDoModulo("painel", fontes)).sort()).toEqual(
      [...NOMES_DAS_FERRAMENTAS, ...NOMES_DAS_FERRAMENTAS_FINANCEIRAS].sort(),
    );
  });

  it("prompt proprio no Financas e os dois no Painel", () => {
    const financas = montarSistema({ modo: "personal", hoje: HOJE, modulo: "financas" });
    expect(financas).toContain("Bolsiq Finanças");
    expect(financas).not.toContain("sugerir_aporte nesta conversa");
    const painel = montarSistema({ modo: "educational", hoje: HOJE, modulo: "painel" });
    expect(painel).toContain("Modo educacional");
    expect(painel).toContain("capacidade_aporte e, se a capacidade");
    const invest = montarSistema({ modo: "personal", hoje: HOJE });
    expect(invest).not.toContain("Bolsiq Finanças");
  });

  it("modulo pelo caminho", () => {
    expect(moduloDoCaminho("/financas")).toBe("financas");
    expect(moduloDoCaminho("/financas/insights")).toBe("financas");
    expect(moduloDoCaminho("/painel")).toBe("painel");
    expect(moduloDoCaminho("/ativo/PETR4")).toBe("investimentos");
    expect(moduloDoCaminho(undefined)).toBe("investimentos");
  });
});
