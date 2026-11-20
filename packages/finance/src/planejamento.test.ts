import { describe, expect, it } from "vitest";
import { compararPlanejamento } from "./planejamento.js";

const cats = new Map([
  ["salario", { nome: "Salário", natureza: "receita" as const }],
  ["moradia", { nome: "Moradia", natureza: "despesa" as const }],
  ["mercado", { nome: "Mercado", natureza: "despesa" as const }],
  ["lazer", { nome: "Lazer", natureza: "despesa" as const }],
]);

describe("planejado x realizado", () => {
  it("soma por categoria, separa fixos e calcula a sobra", () => {
    const r = compararPlanejamento(
      [
        { category_id: "salario", valor: "6000.00", fixo: true },
        { category_id: "moradia", valor: "1800.00", fixo: true },
        { category_id: "mercado", valor: "800.00", fixo: false },
        { category_id: "mercado", valor: "200.00", fixo: false },
      ],
      [
        { category_id: "salario", realizado: "6000.00", previsto: "0.00" },
        { category_id: "mercado", realizado: "900.00", previsto: "150.00" },
        // Gasto sem planejamento aparece com planejado zero.
        { category_id: "lazer", realizado: "120.00", previsto: "0.00" },
        { category_id: "apagada", realizado: "1.00", previsto: "0.00" },
      ],
      cats,
    );
    expect(r.totais).toEqual({
      receitas_planejadas: "6000.00",
      despesas_planejadas: "2800.00",
      despesas_fixas: "1800.00",
      despesas_variaveis: "1000.00",
      sobra_planejada: "3200.00",
      receitas_realizadas: "6000.00",
      despesas_realizadas: "1020.00",
    });
    expect(r.categorias.map((c) => [c.nome, c.planejado, c.restante])).toEqual([
      ["Salário", "6000.00", "0.00"],
      ["Moradia", "1800.00", "1800.00"],
      ["Mercado", "1000.00", "-50.00"],
      ["Lazer", "0.00", "-120.00"],
    ]);
  });
});
