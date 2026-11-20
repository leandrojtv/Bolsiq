import { describe, expect, it } from "vitest";
import { d } from "../decimal.js";
import { contexto, lanc } from "./fabrica.js";
import { concentracao, rankingDeGastos } from "./ranking.js";

describe("rankingDeGastos", () => {
  it("categorias e estabelecimentos por valor, % da renda e concentracao", () => {
    const ls = [
      lanc({
        tipo: "receita",
        valor: "10000.00",
        data: "2026-11-05",
        category_id: "Salário",
      }),
      lanc({
        valor: "2000.00",
        data: "2026-11-01",
        descricao: "Aluguel",
        category_id: "Moradia",
      }),
      lanc({
        valor: "800.00",
        data: "2026-11-03",
        descricao: "Pao de Acucar",
        category_id: "Mercado",
      }),
      lanc({
        valor: "400.00",
        data: "2026-11-10",
        descricao: "Pao de Acucar",
        category_id: "Mercado",
      }),
      lanc({
        valor: "300.00",
        data: "2026-11-12",
        descricao: "Ifood",
        category_id: "Restaurantes e delivery",
      }),
      lanc({ valor: "100.00", data: "2026-11-14", descricao: "Uber" }),
      // Fora: outro mes, previsto e transferencia.
      lanc({ valor: "999.00", data: "2026-10-30", category_id: "Lazer" }),
      lanc({
        valor: "999.00",
        data: "2026-11-25",
        category_id: "Lazer",
        status: "previsto",
      }),
      lanc({
        tipo: "transferencia",
        transferencia_sentido: "saida",
        valor: "999.00",
        data: "2026-11-15",
      }),
    ];
    const [r, ...resto] = rankingDeGastos(contexto(ls));
    expect(resto).toEqual([]);
    expect(r).toMatchObject({
      tipo: "ranking",
      titulo: "Moradia é onde você mais gasta",
      severidade: "info",
      impacto_anual: "0.00",
      periodo: { inicio: "2026-11-01", fim: "2026-11-30" },
    });
    expect(r?.evidencias).toHaveLength(5);
    expect(r?.dados.total).toBe("3600.00");
    expect(r?.dados.pct_da_renda).toBe(36);
    const cats = r?.dados.categorias as {
      nome: string;
      valor: string;
      pct_do_gasto: number;
    }[];
    expect(cats.map((c) => [c.nome, c.valor])).toEqual([
      ["Moradia", "2000.00"],
      ["Mercado", "1200.00"],
      ["Restaurantes e delivery", "300.00"],
      ["Sem categoria", "100.00"],
    ]);
    expect(cats[0]?.pct_do_gasto).toBe(55.6);
    const est = r?.dados.estabelecimentos as { chave: string; lancamentos: number }[];
    expect(est[1]).toMatchObject({ chave: "PAO DE ACUCAR", lancamentos: 2 });
    expect(r?.dados.concentracao).toEqual({
      categorias: 2,
      total_categorias: 4,
      estabelecimentos: 2,
      total_estabelecimentos: 4,
    });
    expect(r?.descricao).toContain("2 de 4 categorias");
    expect(r?.descricao).toContain("36% da renda");
  });

  it("sem despesa no mes, nada; sem renda, sem o percentual", () => {
    expect(rankingDeGastos(contexto([]))).toEqual([]);
    const [r] = rankingDeGastos(contexto([lanc({ valor: "50.00", data: "2026-11-02" })]));
    expect(r?.dados.pct_da_renda).toBeNull();
    expect(r?.descricao.endsWith("concentram 80% do gasto.")).toBe(true);
  });
});

describe("concentracao", () => {
  it("quantos itens somam 80%", () => {
    expect(concentracao(["50", "30", "10", "10"].map(d))).toBe(2);
    expect(concentracao(["25", "25", "25", "25"].map(d))).toBe(4);
    expect(concentracao([])).toBe(0);
  });
});
