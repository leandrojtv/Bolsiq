import { describe, expect, it } from "vitest";
import {
  beta,
  DIAS_UTEIS_ANO,
  desempenho,
  drawdownMaximo,
  retornoAcumulado,
  sharpe,
  volatilidadeAnual,
} from "./desempenho.js";

describe("retornoAcumulado", () => {
  it("compoe, nao soma", () => {
    // +10% e +10% dao 21%, nao 20%.
    expect(retornoAcumulado([0.1, 0.1])).toBeCloseTo(0.21, 10);
  });

  it("serie vazia e indefinida", () => {
    expect(retornoAcumulado([])).toBeNull();
  });

  it("queda total leva a -100%", () => {
    expect(retornoAcumulado([-1])).toBe(-1);
  });
});

describe("volatilidadeAnual", () => {
  it("usa denominador n-1 e anualiza por raiz de 252", () => {
    const r = [0.01, -0.01, 0.01, -0.01];
    // desvio amostral = sqrt(4*0.0001/3) = 0.011547
    expect(volatilidadeAnual(r)).toBeCloseTo(0.011547 * Math.sqrt(DIAS_UTEIS_ANO), 5);
  });

  it("serie constante tem volatilidade zero", () => {
    expect(volatilidadeAnual([0.01, 0.01, 0.01])).toBe(0);
  });

  it("menos de dois pontos e indefinido", () => {
    expect(volatilidadeAnual([0.01])).toBeNull();
    expect(volatilidadeAnual([])).toBeNull();
  });
});

describe("drawdownMaximo", () => {
  it("mede do pico ao vale, nao o pior dia", () => {
    // Sobe 20%, cai 10% duas vezes: a queda acumulada e maior que a diaria.
    const d = drawdownMaximo([0.2, -0.1, -0.1]);
    expect(d).toBeCloseTo((1.2 * 0.9 * 0.9) / 1.2 - 1, 10);
    expect(d).toBeCloseTo(-0.19, 10);
  });

  it("serie que so sobe nao tem drawdown", () => {
    expect(drawdownMaximo([0.01, 0.02, 0.03])).toBe(0);
  });

  it("recuperacao nao apaga o pior momento", () => {
    expect(drawdownMaximo([-0.5, 1.0])).toBe(-0.5);
  });

  it("serie vazia e indefinida", () => {
    expect(drawdownMaximo([])).toBeNull();
  });
});

describe("sharpe", () => {
  it("usa o excesso contra o CDI do mesmo dia", () => {
    const ativo = [0.002, 0.001, 0.003, 0.0];
    const cdi = [0.0005, 0.0005, 0.0005, 0.0005];
    const s = sharpe(ativo, cdi);
    expect(s).not.toBeNull();
    expect(s).toBeGreaterThan(0);
  });

  it("ativo que rende igual ao CDI tem Sharpe indefinido", () => {
    // Excesso constante zero: volatilidade zero, Sharpe sem significado.
    expect(sharpe([0.0005, 0.0005], [0.0005, 0.0005])).toBeNull();
  });

  it("exige series do mesmo tamanho", () => {
    expect(sharpe([0.1, 0.2], [0.1])).toBeNull();
    expect(sharpe([0.1], [0.1])).toBeNull();
  });

  it("ativo abaixo do CDI tem Sharpe negativo", () => {
    const s = sharpe([0.0, 0.001, -0.001, 0.0], [0.002, 0.002, 0.002, 0.002]);
    expect(s).toBeLessThan(0);
  });
});

describe("beta", () => {
  it("ativo igual ao indice tem beta 1", () => {
    const i = [0.01, -0.02, 0.03, -0.01];
    expect(beta(i, i)).toBeCloseTo(1, 10);
  });

  it("ativo com o dobro da oscilacao tem beta 2", () => {
    const i = [0.01, -0.02, 0.03, -0.01];
    expect(
      beta(
        i.map((r) => r * 2),
        i,
      ),
    ).toBeCloseTo(2, 10);
  });

  it("ativo inverso tem beta negativo", () => {
    const i = [0.01, -0.02, 0.03, -0.01];
    expect(
      beta(
        i.map((r) => -r),
        i,
      ),
    ).toBeCloseTo(-1, 10);
  });

  it("indice constante deixa o beta indefinido", () => {
    expect(beta([0.01, 0.02], [0.0, 0.0])).toBeNull();
  });

  it("exige series do mesmo tamanho", () => {
    expect(beta([0.1, 0.2], [0.1])).toBeNull();
  });
});

describe("desempenho", () => {
  it("omite Sharpe e beta quando falta benchmark", () => {
    const d = desempenho({ ativo: [0.01, -0.01, 0.02] });
    expect(d.retorno_periodo).not.toBeNull();
    expect(d.volatilidade_anual).not.toBeNull();
    expect(d.drawdown_maximo).not.toBeNull();
    expect(d.sharpe).toBeNull();
    expect(d.beta).toBeNull();
  });

  it("calcula tudo quando os benchmarks vem", () => {
    const d = desempenho({
      ativo: [0.01, -0.01, 0.02, 0.0],
      cdi: [0.0004, 0.0004, 0.0004, 0.0004],
      ibov: [0.008, -0.012, 0.015, 0.001],
    });
    expect(d.sharpe).not.toBeNull();
    expect(d.beta).not.toBeNull();
  });
});
