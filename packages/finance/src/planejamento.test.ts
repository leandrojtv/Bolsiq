import { describe, expect, it } from "vitest";
import { compararPlanejamento, valorProprio } from "./planejamento.js";

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
      despesas_de_terceiros: "0.00",
    });
    expect(r.categorias.map((c) => [c.nome, c.planejado, c.restante])).toEqual([
      ["Salário", "6000.00", "0.00"],
      ["Moradia", "1800.00", "1800.00"],
      ["Mercado", "1000.00", "-50.00"],
      ["Lazer", "0.00", "-120.00"],
    ]);
  });

  it("item dividido entra no orcamento so pela parte do usuario", () => {
    const r = compararPlanejamento(
      [
        { category_id: "salario", valor: "6000.00", fixo: true },
        { category_id: "moradia", valor: "3000.00", fixo: true, parte_propria: 50 },
        { category_id: "moradia", valor: "200.00", fixo: true, parte_propria: null },
        { category_id: "mercado", valor: "1000.00", fixo: false, parte_propria: 60 },
      ],
      [{ category_id: "moradia", realizado: "1500.00", previsto: "0.00" }],
      cats,
    );
    expect(r.totais).toMatchObject({
      despesas_planejadas: "2300.00",
      despesas_fixas: "1700.00",
      despesas_variaveis: "600.00",
      sobra_planejada: "3700.00",
      despesas_de_terceiros: "1900.00",
    });
    expect(r.categorias.find((c) => c.nome === "Moradia")).toMatchObject({
      planejado: "1700.00",
      restante: "200.00",
    });
  });
});

describe("parte propria", () => {
  it("arredonda em centavos e sem divisao devolve o fechado", () => {
    expect(valorProprio("100.00", 33.33)).toBe("33.33");
    expect(valorProprio("1000.00", 33.33)).toBe("333.30");
    expect(valorProprio("1234.56", null)).toBe("1234.56");
  });
});
