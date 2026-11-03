import { describe, expect, it } from "vitest";
import {
  base100,
  estatisticas,
  identificadoresDaUrl,
  inicioDaComparacao,
  melhoresDaLinha,
  nivelDeTaxa,
  SENTIDO,
  tipoDoIdentificador,
} from "./comparador.js";
import { IndicadorFiltravel } from "./screener.js";

describe("melhor de cada linha", () => {
  it("toda linha filtravel tem sentido, menos beta", () => {
    const sem = IndicadorFiltravel.options.filter((i) => !SENTIDO[i]);
    expect(sem).toEqual(["beta"]);
  });

  it("maior e menor", () => {
    expect(melhoresDaLinha("roe", [0.1, 0.25, null, 0.2])).toEqual([1]);
    expect(melhoresDaLinha("dl_ebitda", [1.7, 0.9, -0.4])).toEqual([2]);
  });

  it("multiplo de preco: menor entre os positivos", () => {
    // P/L negativo e prejuizo, nao e o mais barato.
    expect(melhoresDaLinha("pl", [6.1, -3, 22.4, null])).toEqual([0]);
  });

  it("empate marca todos; menos de dois valores nao destaca", () => {
    expect(melhoresDaLinha("dy_12m", [0.06, 0.06, 0.01])).toEqual([0, 1]);
    expect(melhoresDaLinha("roe", [0.2, null])).toEqual([]);
    expect(melhoresDaLinha("beta", [0.5, 1.2])).toEqual([]);
  });

  it("drawdown menos negativo e melhor", () => {
    expect(melhoresDaLinha("drawdown_maximo", [-0.35, -0.1])).toEqual([1]);
  });
});

describe("series", () => {
  it("base 100", () => {
    expect(
      base100([
        { date: "a", valor: 50 },
        { date: "b", valor: 55 },
      ]),
    ).toEqual([
      { date: "a", valor: 100 },
      { date: "b", valor: 110 },
    ]);
    expect(base100([])).toEqual([]);
  });

  it("nivel de taxa compoe em decimal", () => {
    const n = nivelDeTaxa([
      { date: "a", value: "1" },
      { date: "b", value: "1" },
    ]);
    expect(n.at(-1)?.valor).toBeCloseTo(1.0201, 10);
  });

  it("estatisticas com e sem volatilidade", () => {
    const pontos = [100, 110, 99, 120].map((valor, i) => ({ date: String(i), valor }));
    const e = estatisticas(pontos);
    expect(e.retorno).toBeCloseTo(0.2, 6);
    expect(e.drawdown_maximo).toBeCloseTo(-0.1, 6);
    expect(e.volatilidade_anual).not.toBeNull();
    expect(estatisticas(pontos, false).volatilidade_anual).toBeNull();
  });
});

describe("identificadores", () => {
  it("classifica ticker, fundo e indice", () => {
    expect(tipoDoIdentificador("PETR4")).toBe("ativo");
    expect(tipoDoIdentificador("00017024000153")).toBe("fundo");
    expect(tipoDoIdentificador("IBOV")).toBe("indice");
    expect(tipoDoIdentificador("x")).toBeNull();
  });

  it("le a URL: maiusculas, CNPJ com pontuacao, sem repetidos, ate 6", () => {
    expect(identificadoresDaUrl("petr4,00.017.024/0001-53,PETR4,cdi,??")).toEqual([
      "PETR4",
      "00017024000153",
      "CDI",
    ]);
    expect(identificadoresDaUrl("A1B2,C1D2,E1F2,G1H2,I1J2,K1L2,M1N2")).toHaveLength(6);
    expect(identificadoresDaUrl(null)).toEqual([]);
  });

  it("inicio do periodo", () => {
    expect(inicioDaComparacao("2A", "2026-11-02")).toBe("2024-11-02");
    expect(inicioDaComparacao("Máx", "2026-11-02")).toBe("1990-01-01");
  });
});
