import { describe, expect, it } from "vitest";
import { IndicadorFiltravel } from "./screener.js";
import {
  ajudaDoIndicador,
  avaliarIndicador,
  avaliarIndicadores,
  REGRAS_DOS_SINAIS,
} from "./sinais.js";

describe("avaliarIndicador", () => {
  it("P/L: menor e melhor, com limite de Graham", () => {
    expect(avaliarIndicador("pl", 8)?.nivel).toBe("verde");
    expect(avaliarIndicador("pl", 15)?.nivel).toBe("verde");
    expect(avaliarIndicador("pl", 20)?.nivel).toBe("amarelo");
    expect(avaliarIndicador("pl", 30)?.nivel).toBe("vermelho");
  });

  it("P/L negativo e prejuizo, nao barato", () => {
    const s = avaliarIndicador("pl", -4);
    expect(s?.nivel).toBe("vermelho");
    expect(s?.leitura).toMatch(/prejuízo/);
  });

  it("divida liquida negativa e caixa liquido", () => {
    expect(avaliarIndicador("dl_ebitda", -0.5)).toEqual({
      nivel: "verde",
      leitura: expect.stringMatching(/caixa líquido/) as string,
    });
    expect(avaliarIndicador("dl_ebitda", 3)?.nivel).toBe("amarelo");
    expect(avaliarIndicador("dl_ebitda", 4)?.nivel).toBe("vermelho");
  });

  it("maior e melhor: ROE e DY", () => {
    expect(avaliarIndicador("roe", 0.2)?.nivel).toBe("verde");
    expect(avaliarIndicador("roe", 0.1)?.nivel).toBe("amarelo");
    expect(avaliarIndicador("roe", 0.02)?.nivel).toBe("vermelho");
    expect(avaliarIndicador("dy_12m", 0.06)?.nivel).toBe("verde");
    expect(avaliarIndicador("dy_12m", 0.01)?.nivel).toBe("vermelho");
  });

  it("Graham: desconto de 20% indica compra, preco acima do justo e caro", () => {
    expect(avaliarIndicador("margem_graham", 0.35)?.leitura).toMatch(/indica compra/);
    expect(avaliarIndicador("margem_graham", 0.1)?.nivel).toBe("amarelo");
    expect(avaliarIndicador("margem_graham", -0.2)?.leitura).toMatch(/acima do justo/);
  });

  it("Bazin: abaixo do teto indica compra", () => {
    expect(avaliarIndicador("margem_bazin", 0)?.nivel).toBe("verde");
    expect(avaliarIndicador("margem_bazin", -0.05)?.nivel).toBe("amarelo");
    expect(avaliarIndicador("margem_bazin", -0.3)?.nivel).toBe("vermelho");
  });

  it("sem valor ou sem regra, sem sinal", () => {
    expect(avaliarIndicador("pl", null)).toBeNull();
    expect(avaliarIndicador("pl", Number.NaN)).toBeNull();
    expect(avaliarIndicador("cotistas", 1000)).toBeNull();
  });
});

describe("regras", () => {
  it("limite do verde vem antes do amarelo no sentido da regra", () => {
    for (const r of Object.values(REGRAS_DOS_SINAIS)) {
      if (r.sentido === "menor") expect(r.verde).toBeLessThan(r.amarelo);
      else expect(r.verde).toBeGreaterThan(r.amarelo);
    }
  });

  it("toda regra e de indicador filtravel e tem ajuda", () => {
    for (const nome of Object.keys(REGRAS_DOS_SINAIS)) {
      const n = IndicadorFiltravel.parse(nome);
      expect(ajudaDoIndicador(n)?.descricao.length).toBeGreaterThan(10);
    }
    expect(ajudaDoIndicador("cotistas")).toBeNull();
  });
});

describe("avaliarIndicadores", () => {
  it("so devolve os indicadores com valor e regra", () => {
    expect(avaliarIndicadores({ pl: 10, pvp: null, cotistas: 5 })).toEqual({
      pl: { nivel: "verde", leitura: expect.any(String) as string },
    });
  });
});
