import { describe, expect, it } from "vitest";
import { DadosDeMercado, Demonstrativo, SerieDeRetornos } from "./tipos.js";
import { DFP_2024 } from "./cvm.fixtures.js";
import { calcularIndicadores } from "./indicadores.js";
import { TAXA_BAZIN_PADRAO } from "./precoJusto.js";

describe("Demonstrativo", () => {
  it("aceita um demonstrativo real da CVM", () => {
    expect(() => Demonstrativo.parse(DFP_2024.PETR4.demonstrativo)).not.toThrow();
  });

  it("recusa valor monetario como number", () => {
    expect(() =>
      Demonstrativo.parse({ ...DFP_2024.PETR4.demonstrativo, receita: 490829000000 }),
    ).toThrow();
  });

  it("exige todas as contas", () => {
    const { receita: _r, ...incompleto } = DFP_2024.PETR4.demonstrativo;
    expect(() => Demonstrativo.parse(incompleto)).toThrow();
  });

  it("recusa data fora de YYYY-MM-DD", () => {
    expect(() =>
      Demonstrativo.parse({
        ...DFP_2024.PETR4.demonstrativo,
        reference_date: "31/12/2024",
      }),
    ).toThrow();
  });
});

describe("DadosDeMercado", () => {
  it("exige acoes inteiro positivo", () => {
    expect(() => DadosDeMercado.parse({ preco: "10", acoes: 0 })).toThrow();
    expect(() => DadosDeMercado.parse({ preco: "10", acoes: 1.5 })).toThrow();
    expect(DadosDeMercado.parse({ preco: "10", acoes: 100 }).acoes).toBe(100);
  });

  it("proventos sao opcionais e em string decimal", () => {
    expect(
      DadosDeMercado.parse({ preco: "10", acoes: 1, proventos_por_ano: ["0.5"] })
        .proventos_por_ano,
    ).toEqual(["0.5"]);
    expect(() =>
      DadosDeMercado.parse({ preco: "10", acoes: 1, proventos_12m: 0.8 }),
    ).toThrow();
  });
});

describe("SerieDeRetornos", () => {
  it("aceita so o ativo", () => {
    expect(SerieDeRetornos.parse({ ativo: [0.01, -0.02] }).cdi).toBeUndefined();
  });

  it("recusa retorno como string", () => {
    expect(() => SerieDeRetornos.parse({ ativo: ["0.01"] })).toThrow();
  });
});

describe("calcularIndicadores com todas as entradas opcionais", () => {
  const caso = DFP_2024.PETR4;

  it("preenche CAGR, desempenho e usa a taxa de Bazin informada", () => {
    const i = calcularIndicadores({
      demonstrativo: caso.demonstrativo,
      mercado: {
        preco: "38.42",
        acoes: caso.acoes,
        proventos_12m: "3.80",
        proventos_por_ano: ["3.5", "4.2", "8.9", "6.1", "3.8"],
      },
      historico_receita: ["300000000000", "490829000000"],
      historico_lucro: ["20000000000", "37009000000"],
      retornos: {
        ativo: [0.01, -0.02, 0.015, 0.0],
        cdi: [0.0004, 0.0004, 0.0004, 0.0004],
        ibov: [0.008, -0.015, 0.012, 0.001],
      },
      taxa_bazin: 0.1,
    });

    expect(i.cagr_receita_5a).not.toBeNull();
    expect(i.cagr_lucro_5a).not.toBeNull();
    expect(i.dy_12m).toBeCloseTo(3.8 / 38.42, 6);
    expect(i.sharpe).not.toBeNull();
    expect(i.beta).not.toBeNull();
    expect(i.retorno_periodo).not.toBeNull();
    expect(i.drawdown_maximo).toBeLessThan(0);
    // Taxa de 10% em vez dos 6% padrao baixa o teto.
    const comPadrao = calcularIndicadores({
      demonstrativo: caso.demonstrativo,
      mercado: {
        preco: "38.42",
        acoes: caso.acoes,
        proventos_por_ano: ["3.5", "4.2", "8.9", "6.1", "3.8"],
      },
    });
    expect(Number(i.preco_bazin)).toBeLessThan(Number(comPadrao.preco_bazin));
    expect(TAXA_BAZIN_PADRAO).toBe(0.06);
  });

  it("sem entradas opcionais, os indicadores que dependem delas ficam nulos", () => {
    const i = calcularIndicadores({
      demonstrativo: caso.demonstrativo,
      mercado: { preco: "38.42", acoes: caso.acoes },
    });
    expect(i.cagr_receita_5a).toBeNull();
    expect(i.cagr_lucro_5a).toBeNull();
    expect(i.sharpe).toBeNull();
    expect(i.beta).toBeNull();
    expect(i.preco_bazin).toBeNull();
    expect(i.retorno_periodo).toBeNull();
    // Os fundamentais nao dependem de serie nenhuma.
    expect(i.roe).toBeCloseTo(0.100701, 6);
    expect(i.preco_graham).toBe("42.92");
  });
});
