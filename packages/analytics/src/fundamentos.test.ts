import { describe, expect, it } from "vitest";
import { cagr, derivar, rentabilidade, valuation } from "./fundamentos.js";
import { bazin, graham } from "./precoJusto.js";
import { dividir, d, paraMoeda, paraNumero } from "./decimal.js";

const base = {
  reference_date: "2024-12-31",
  receita: "1000",
  resultado_bruto: "400",
  ebit: "200",
  lucro_liquido: "100",
  depreciacao_amortizacao: "50",
  ativo_total: "2000",
  ativo_circulante: "600",
  caixa_equivalentes: "100",
  passivo_circulante: "300",
  patrimonio_liquido: "800",
  divida_bruta: "500",
};
const mkt = { preco: "10", acoes: 100 };

describe("dividir", () => {
  it("denominador zero e indefinido, nao infinito", () => {
    expect(dividir(d(1), d(0))).toBeNull();
    expect(paraNumero(null)).toBeNull();
    expect(paraMoeda(null)).toBeNull();
  });
});

describe("indicadores indefinidos", () => {
  it("empresa sem lucro nao tem P/L", () => {
    const v = valuation({ ...base, lucro_liquido: "0" }, mkt);
    expect(v.pl).toBeNull();
  });

  it("empresa sem EBITDA nao tem EV/EBITDA", () => {
    const dem = { ...base, ebit: "0", depreciacao_amortizacao: "0" };
    expect(valuation(dem, mkt).ev_ebitda).toBeNull();
  });

  it("patrimonio zero deixa ROE e P/VP indefinidos", () => {
    const dem = { ...base, patrimonio_liquido: "0" };
    expect(valuation(dem, mkt).pvp).toBeNull();
    expect(rentabilidade(dem, derivar(dem, mkt)).roe).toBeNull();
  });

  it("DY sem proventos informados e indefinido", () => {
    expect(valuation(base, mkt).dy_12m).toBeNull();
    expect(valuation(base, mkt).dy_medio_5a).toBeNull();
  });

  it("DY 12m usa os proventos informados", () => {
    expect(valuation(base, { ...mkt, proventos_12m: "0.8" }).dy_12m).toBeCloseTo(0.08, 6);
  });

  it("DY medio usa so os ultimos cinco anos", () => {
    const v = valuation(base, {
      ...mkt,
      proventos_por_ano: ["99", "1", "1", "1", "1", "1"],
    });
    // O 99 fica de fora: media dos cinco ultimos e 1.
    expect(v.dy_medio_5a).toBeCloseTo(0.1, 6);
  });
});

describe("cagr", () => {
  it("dobrar em 4 anos da cerca de 18,9% ao ano", () => {
    expect(cagr(["100", "0", "0", "0", "200"])).toBeCloseTo(2 ** (1 / 4) - 1, 6);
  });

  it("base nao positiva nao tem CAGR", () => {
    // Sair de prejuizo para lucro nao tem taxa composta definida.
    expect(cagr(["-10", "50"])).toBeNull();
    expect(cagr(["0", "50"])).toBeNull();
  });

  it("final nao positivo nao tem CAGR", () => {
    expect(cagr(["100", "-10"])).toBeNull();
  });

  it("serie curta nao tem CAGR", () => {
    expect(cagr(["100"])).toBeNull();
    expect(cagr([])).toBeNull();
  });

  it("aceita numero de anos explicito", () => {
    expect(cagr(["100", "200"], 1)).toBeCloseTo(1, 6);
  });
});

describe("graham", () => {
  it("LPA 1 e VPA 10 dao 15", () => {
    expect(graham("1", "10", "10").valor).toBe("15.00");
  });

  it("margem positiva quando o preco esta abaixo do justo", () => {
    expect(graham("1", "10", "10").margem_seguranca).toBeCloseTo(1 / 3, 6);
  });

  it("LPA ou VPA nao positivos saem do escopo da formula", () => {
    expect(graham("-1", "10", "10").valor).toBeNull();
    expect(graham("1", "-10", "10").valor).toBeNull();
    expect(graham("0", "10", "10").valor).toBeNull();
    expect(graham(null, "10", "10").valor).toBeNull();
    expect(graham("1", null, "10").valor).toBeNull();
  });
});

describe("bazin", () => {
  it("dividendo medio 0,60 a 6% da teto de 10", () => {
    expect(bazin(["0.6", "0.6", "0.6"], "8").valor).toBe("10.00");
  });

  it("taxa configuravel muda o teto", () => {
    expect(bazin(["0.6"], "8", 0.1).valor).toBe("6.00");
  });

  it("usa a media, nao o ultimo ano", () => {
    // Um ano excepcional nao deve elevar um teto que existe para ser conservador.
    expect(bazin(["0.2", "0.2", "0.2", "0.2", "2.0"], "10").valor).toBe("9.33");
  });

  it("sem proventos, sem teto", () => {
    expect(bazin([], "10").valor).toBeNull();
    expect(bazin(["0"], "10").valor).toBeNull();
  });

  it("taxa zero ou negativa nao produz teto", () => {
    expect(bazin(["0.6"], "10", 0).valor).toBeNull();
    expect(bazin(["0.6"], "10", -0.01).valor).toBeNull();
  });
});
