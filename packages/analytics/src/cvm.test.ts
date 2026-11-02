import { describe, expect, it } from "vitest";
import { DFP_2024 } from "./cvm.fixtures.js";
import { derivar, endividamento, rentabilidade, valuation } from "./fundamentos.js";
import { calcularIndicadores } from "./indicadores.js";

/**
 * Os valores esperados foram calculados fora deste codigo, em Python, a partir
 * dos mesmos numeros do DFP. Nao sao a saida desta implementacao congelada:
 * se os dois caminhos concordam, a formula esta certa.
 */
const ESPERADO = {
  PETR4: {
    ebitda: "204234000000.00",
    divida_liquida: "353213000000.00",
    margem_bruta: 0.502134,
    margem_ebitda: 0.4161,
    margem_liquida: 0.075401,
    roe: 0.100701,
    roa: 0.032903,
    roic: 0.125641,
    liquidez_corrente: 0.694078,
    dl_ebitda: 1.729452,
    dl_pl: 0.961087,
    lpa: 2.871423,
    vpa: 28.514363,
  },
  VALE3: {
    ebitda: "71984000000.00",
    divida_liquida: "65341000000.00",
    margem_bruta: 0.362549,
    margem_ebitda: 0.349428,
    margem_liquida: 0.14772,
    roe: 0.142387,
    roa: 0.061313,
    roic: 0.131165,
    liquidez_corrente: 1.029869,
    dl_ebitda: 0.907716,
    dl_pl: 0.305732,
  },
  WEGE3: {
    ebitda: "8503013000.00",
    divida_liquida: "-3752362000.00",
    margem_bruta: 0.337322,
    margem_ebitda: 0.22384,
    margem_liquida: 0.16634,
    roe: 0.273241,
    roa: 0.152297,
    roic: 0.262003,
    liquidez_corrente: 1.761414,
    dl_ebitda: -0.441298,
    dl_pl: -0.162263,
    lpa: 1.506068,
    vpa: 5.511861,
  },
} as const;

describe.each(["PETR4", "VALE3", "WEGE3"] as const)(
  "indicadores contra o DFP 2024 da CVM: %s",
  (ticker) => {
    const caso = DFP_2024[ticker];
    const esperado = ESPERADO[ticker];
    const dem = caso.demonstrativo;
    // Acoes nao influenciam nenhum indicador deste bloco; 1 serve de marcador
    // para a Vale, cujo numero de acoes a fonte reporta em escala diferente.
    const mkt = { preco: "1", acoes: caso.acoes ?? 1 };
    const der = derivar(dem, mkt);

    it("EBITDA soma EBIT e depreciacao", () => {
      expect(der.ebitda.toFixed(2)).toBe(esperado.ebitda);
    });

    it("divida liquida desconta o caixa", () => {
      expect(der.divida_liquida.toFixed(2)).toBe(esperado.divida_liquida);
    });

    it("margens", () => {
      const r = rentabilidade(dem, der);
      expect(r.margem_bruta).toBeCloseTo(esperado.margem_bruta, 6);
      expect(r.margem_ebitda).toBeCloseTo(esperado.margem_ebitda, 6);
      expect(r.margem_liquida).toBeCloseTo(esperado.margem_liquida, 6);
    });

    it("retorno sobre capital", () => {
      const r = rentabilidade(dem, der);
      expect(r.roe).toBeCloseTo(esperado.roe, 6);
      expect(r.roa).toBeCloseTo(esperado.roa, 6);
      expect(r.roic).toBeCloseTo(esperado.roic, 6);
    });

    it("endividamento e liquidez", () => {
      const e = endividamento(dem, der);
      expect(e.liquidez_corrente).toBeCloseTo(esperado.liquidez_corrente, 6);
      expect(e.dl_ebitda).toBeCloseTo(esperado.dl_ebitda, 6);
      expect(e.dl_pl).toBeCloseTo(esperado.dl_pl, 6);
    });
  },
);

describe("indicadores por acao, onde o numero de acoes e confiavel", () => {
  it("PETR4: LPA e VPA", () => {
    const caso = DFP_2024.PETR4;
    const der = derivar(caso.demonstrativo, { preco: "1", acoes: caso.acoes });
    expect(der.lpa?.toNumber()).toBeCloseTo(ESPERADO.PETR4.lpa, 6);
    expect(der.vpa?.toNumber()).toBeCloseTo(ESPERADO.PETR4.vpa, 6);
  });

  it("WEGE3: LPA e VPA", () => {
    const caso = DFP_2024.WEGE3;
    const der = derivar(caso.demonstrativo, { preco: "1", acoes: caso.acoes });
    expect(der.lpa?.toNumber()).toBeCloseTo(ESPERADO.WEGE3.lpa, 6);
    expect(der.vpa?.toNumber()).toBeCloseTo(ESPERADO.WEGE3.vpa, 6);
  });
});

describe("valuation da PETR4 a 38,42", () => {
  const caso = DFP_2024.PETR4;
  const mkt = {
    preco: "38.42",
    acoes: caso.acoes,
    proventos_por_ano: ["3.5", "4.2", "8.9", "6.1", "3.8"],
  };

  it("multiplos", () => {
    const v = valuation(caso.demonstrativo, mkt);
    expect(v.pl).toBeCloseTo(13.380127, 5);
    expect(v.pvp).toBeCloseTo(1.347391, 5);
    expect(v.ev_ebitda).toBeCloseTo(4.154049, 5);
    expect(v.ev_ebit).toBeCloseTo(6.183615, 5);
    expect(v.p_receita).toBeCloseTo(1.008875, 5);
    expect(v.dy_medio_5a).toBeCloseTo(0.137949, 5);
  });

  it("preco justo de Graham e preco-teto de Bazin", () => {
    const i = calcularIndicadores({ demonstrativo: caso.demonstrativo, mercado: mkt });
    expect(i.preco_graham).toBe("42.92");
    expect(i.margem_graham).toBeCloseTo(0.104871, 5);
    expect(i.preco_bazin).toBe("88.33");
    expect(i.margem_bazin).toBeCloseTo(0.565057, 5);
  });
});

describe("WEGE3 a 52,10: caso de empresa cara para os dois metodos", () => {
  const caso = DFP_2024.WEGE3;
  const mkt = {
    preco: "52.10",
    acoes: caso.acoes,
    proventos_por_ano: ["0.4", "0.5", "0.55", "0.6", "0.7"],
  };

  it("margem de seguranca negativa nao e erro, e o resultado", () => {
    const i = calcularIndicadores({ demonstrativo: caso.demonstrativo, mercado: mkt });
    expect(i.pl).toBeCloseTo(34.5934, 4);
    expect(i.pvp).toBeCloseTo(9.452344, 5);
    expect(i.preco_graham).toBe("13.67");
    expect(i.margem_graham).toBeCloseTo(-2.812195, 5);
    expect(i.preco_bazin).toBe("9.17");
    expect(i.margem_bazin).toBeCloseTo(-4.683636, 5);
  });

  it("caixa liquido aparece como divida liquida negativa", () => {
    const i = calcularIndicadores({ demonstrativo: caso.demonstrativo, mercado: mkt });
    expect(i.divida_liquida).toBe("-3752362000.00");
    expect(i.dl_ebitda).toBeLessThan(0);
  });
});
