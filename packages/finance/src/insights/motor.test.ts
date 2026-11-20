import { describe, expect, it } from "vitest";
import { contexto, lanc, serie } from "./fabrica.js";
import {
  aplicarFeedback,
  gerarInsights,
  inicioDaJanela,
  novidades,
  ordenar,
  visivel,
  type Feedback,
} from "./motor.js";
import type { Insight } from "./tipos.js";

const MENSAL = ["2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05"];

const insight = (over: Partial<Insight>): Insight => ({
  id: "x-1",
  tipo: "assinatura",
  titulo: "",
  descricao: "",
  impacto_mensal: "10.00",
  impacto_anual: "120.00",
  severidade: "baixa",
  evidencias: [],
  acao_sugerida: "",
  periodo: { inicio: "2026-11-01", fim: "2026-11-20" },
  dados: {},
  ...over,
});

const fb = (
  acao: Feedback["acao"],
  registrado_em = "2026-11-01",
  impacto_anual = "120.00",
): Feedback => ({
  insight_id: "x-1",
  acao,
  impacto_anual,
  registrado_em,
});

describe("gerarInsights", () => {
  it("junta os detectores e ordena por impacto anual", () => {
    const ls = [
      lanc({ tipo: "receita", valor: "5000.00", data: "2026-11-05" }),
      ...serie("Netflix", "39.90", MENSAL),
      lanc({ descricao: "Juros Rotativo", valor: "300.00", data: "2026-10-15" }),
      lanc({ valor: "50.00", data: "2026-11-08", category_id: "Mercado" }),
    ];
    const { insights, assinaturas } = gerarInsights(contexto(ls));
    expect(assinaturas).toHaveLength(1);
    expect(insights.map((i) => i.tipo)).toEqual([
      "assinatura",
      "tarifas",
      "essencial_superfluo",
      "ranking",
    ]);
  });
});

describe("ordenar", () => {
  it("empate no impacto: severidade, depois id", () => {
    const r = ordenar([
      insight({ id: "b", severidade: "info", impacto_anual: "0.00" }),
      insight({ id: "c", severidade: "baixa", impacto_anual: "0.00" }),
      insight({ id: "a", severidade: "baixa", impacto_anual: "0.00" }),
      insight({ id: "z", impacto_anual: "50.00" }),
    ]);
    expect(r.map((i) => i.id)).toEqual(["z", "a", "c", "b"]);
  });
});

describe("visivel e aplicarFeedback", () => {
  it("dispensado some por 90 dias, a nao ser que o valor suba mais de 20%", () => {
    const i = insight({});
    expect(visivel(i, undefined, "2026-11-20")).toBe(true);
    expect(visivel(i, fb("dispensado"), "2026-11-20")).toBe(false);
    expect(visivel(i, fb("dispensado", "2026-08-20"), "2026-11-20")).toBe(true);
    expect(
      visivel(insight({ impacto_anual: "144.00" }), fb("dispensado"), "2026-11-20"),
    ).toBe(false);
    expect(
      visivel(insight({ impacto_anual: "144.01" }), fb("dispensado"), "2026-11-20"),
    ).toBe(true);
    expect(visivel(i, fb("ainda_uso"), "2026-11-20")).toBe(false);
  });

  it("vou cancelar continua; ja cancelei some ate nova cobranca", () => {
    const a = (ultima: string) => insight({ dados: { assinatura: { ultima } } });
    expect(visivel(a("2026-11-05"), fb("vou_cancelar"), "2026-11-20")).toBe(true);
    expect(visivel(a("2026-10-05"), fb("ja_cancelei"), "2026-11-20")).toBe(false);
    expect(visivel(a("2026-11-05"), fb("ja_cancelei"), "2026-11-20")).toBe(true);
    expect(visivel(insight({}), fb("ja_cancelei"), "2026-11-20")).toBe(false);
  });

  it("marca o feedback e conta os ocultos", () => {
    const r = aplicarFeedback(
      [insight({}), insight({ id: "y-2" }), insight({ id: "z-3" })],
      [fb("dispensado"), { ...fb("vou_cancelar"), insight_id: "y-2" }],
      "2026-11-20",
    );
    expect(r.ocultos).toBe(1);
    expect(r.visiveis.map((i) => [i.id, i.feedback?.acao ?? null])).toEqual([
      ["y-2", "vou_cancelar"],
      ["z-3", null],
    ]);
  });
});

describe("novidades", () => {
  it("assinatura nova, reajuste e tarifa nova, com chave estavel", () => {
    const ls = [
      ...serie("Globoplay", "24.90", ["2026-09-10", "2026-10-08"]),
      lanc({ descricao: "Globoplay", valor: "26.90", data: "2026-11-05" }),
      lanc({ descricao: "Tarifa Saque", valor: "6.50", data: "2026-11-02" }),
    ];
    const { insights } = gerarInsights(contexto(ls));
    const n = novidades(insights);
    expect(n.map((x) => x.motivo)).toEqual([
      "assinatura_nova",
      "reajuste",
      "tarifa_nova",
    ]);
    expect(n[1]?.chave).toMatch(/^reajuste:assinatura-[0-9a-z]+:26\.90$/);
    expect(n[2]?.chave).toBe("tarifa_nova:TARIFA SAQUE:2026-11-02");
    expect(novidades([insight({ tipo: "formiga" })])).toEqual([]);
  });
});

describe("inicioDaJanela", () => {
  it("o mais antigo entre 6 meses antes do mes e 400 dias antes de hoje", () => {
    expect(inicioDaJanela("2026-11", "2026-11-20")).toBe("2025-10-16");
    expect(inicioDaJanela("2024-01", "2026-11-20")).toBe("2023-07-01");
  });
});
