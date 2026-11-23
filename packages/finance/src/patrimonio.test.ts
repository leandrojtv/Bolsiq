import { describe, expect, it } from "vitest";
import {
  comporPatrimonio,
  mesAnteriorA,
  PORTFOLIO_VAZIO,
  Patrimonio,
  taxaDePoupanca,
  type PartesDoPortfolio,
} from "./patrimonio.js";

const portfolio: PartesDoPortfolio = {
  renda_variavel: "30000.00",
  renda_fixa: "15000.00",
  fundos: "5000.00",
  carteiras: [
    { id: "c1", nome: "Longo prazo", valor: "45000.00" },
    { id: "c2", nome: "Previdência", valor: "5000.00" },
  ],
  avaliadas_em: "2026-11-20T15:00:00.000Z",
};

describe("comporPatrimonio", () => {
  it("contas + carteiras - faturas - dividas, com a composicao", () => {
    const p = comporPatrimonio(
      { contas: "10000.00", faturas: "2500.50", dividas: "20000.00" },
      portfolio,
    );
    expect(Patrimonio.parse(p)).toEqual(p);
    expect(p).toMatchObject({
      patrimonio_liquido: "37499.50",
      ativos: "60000.00",
      passivos: "22500.50",
      faturas: "2500.50",
      dividas: "20000.00",
    });
    expect(p.composicao).toEqual([
      { fatia: "contas", rotulo: "Contas", valor: "10000.00", percentual: 16.7 },
      {
        fatia: "renda_variavel",
        rotulo: "Renda variável",
        valor: "30000.00",
        percentual: 50,
      },
      { fatia: "renda_fixa", rotulo: "Renda fixa", valor: "15000.00", percentual: 25 },
      { fatia: "fundos", rotulo: "Fundos", valor: "5000.00", percentual: 8.3 },
      { fatia: "dividas", rotulo: "Dívidas", valor: "-22500.50", percentual: null },
    ]);
    expect(p.carteiras).toHaveLength(2);
  });

  it("so financas, sem carteira: os grupos do portfolio zerados", () => {
    const p = comporPatrimonio(
      { contas: "1234.56", faturas: "0.00", dividas: "0.00" },
      PORTFOLIO_VAZIO,
    );
    expect(p.patrimonio_liquido).toBe("1234.56");
    expect(p.composicao[0]?.percentual).toBe(100);
    expect(p.carteiras_avaliadas_em).toBeNull();
  });

  it("divida maior que os ativos da patrimonio negativo e sem percentual", () => {
    const p = comporPatrimonio(
      { contas: "-300.00", faturas: "1000.00", dividas: "5000.00" },
      PORTFOLIO_VAZIO,
    );
    expect(p.patrimonio_liquido).toBe("-6300.00");
    expect(p.composicao.every((f) => f.percentual === null)).toBe(true);
  });

  it("soma em decimal, sem erro de ponto flutuante", () => {
    const p = comporPatrimonio(
      { contas: "0.10", faturas: "0.00", dividas: "0.00" },
      { ...PORTFOLIO_VAZIO, renda_variavel: "0.20" },
    );
    expect(p.patrimonio_liquido).toBe("0.30");
  });
});

describe("taxaDePoupanca e mesAnteriorA", () => {
  it("(renda - despesas) / renda, nulo sem renda", () => {
    expect(taxaDePoupanca("8000.00", "6000.00")).toBe(25);
    expect(taxaDePoupanca("5000.00", "6000.00")).toBe(-20);
    expect(taxaDePoupanca("0.00", "100.00")).toBeNull();
  });

  it("mes anterior vira o ano em janeiro", () => {
    expect(mesAnteriorA("2026-12-01")).toBe("2026-11");
    expect(mesAnteriorA("2027-01-01")).toBe("2026-12");
  });
});
