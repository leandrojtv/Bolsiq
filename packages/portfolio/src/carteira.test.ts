import { describe, expect, it } from "vitest";
import { apurar, avaliar } from "./posicao.js";
import { proventosPorMes, alocar } from "./alocacao.js";
import type { Transacao } from "./tipos.js";

/**
 * Carteira de teste: 10 transacoes, um desdobramento e proventos.
 *
 * Os valores esperados foram calculados fora desta implementacao, com Decimal
 * do Python, a partir das mesmas transacoes. E o equivalente a conferir na
 * planilha: dois caminhos independentes chegando ao mesmo numero.
 */
const CARTEIRA: Transacao[] = [
  {
    id: "01",
    ticker: "PETR4",
    tipo: "compra",
    data: "2024-01-15",
    quantidade: "100",
    preco: "35.00",
    taxas: "5.00",
  },
  {
    id: "02",
    ticker: "PETR4",
    tipo: "compra",
    data: "2024-02-10",
    quantidade: "50",
    preco: "38.00",
    taxas: "3.00",
  },
  {
    id: "03",
    ticker: "PETR4",
    tipo: "provento",
    data: "2024-03-05",
    quantidade: "150",
    preco: "0.80",
    taxas: "0",
  },
  {
    id: "04",
    ticker: "VALE3",
    tipo: "compra",
    data: "2024-04-20",
    quantidade: "80",
    preco: "62.00",
    taxas: "4.00",
  },
  {
    id: "05",
    ticker: "PETR4",
    tipo: "venda",
    data: "2024-05-15",
    quantidade: "60",
    preco: "42.00",
    taxas: "6.00",
  },
  {
    id: "06",
    ticker: "PETR4",
    tipo: "desdobramento",
    data: "2024-06-10",
    quantidade: "2",
    preco: "0",
    taxas: "0",
  },
  {
    id: "07",
    ticker: "VALE3",
    tipo: "provento",
    data: "2024-07-01",
    quantidade: "80",
    preco: "1.50",
    taxas: "0",
  },
  {
    id: "08",
    ticker: "VALE3",
    tipo: "compra",
    data: "2024-08-12",
    quantidade: "20",
    preco: "58.00",
    taxas: "2.00",
  },
  {
    id: "09",
    ticker: "VALE3",
    tipo: "venda",
    data: "2024-09-20",
    quantidade: "50",
    preco: "65.00",
    taxas: "5.00",
  },
  {
    id: "10",
    ticker: "PETR4",
    tipo: "provento",
    data: "2024-10-05",
    quantidade: "180",
    preco: "0.45",
    taxas: "0",
  },
];

describe("carteira de 10 transacoes com desdobramento e proventos", () => {
  const r = apurar(CARTEIRA);
  const petr = r.posicoes.find((p) => p.ticker === "PETR4");
  const vale = r.posicoes.find((p) => p.ticker === "VALE3");

  it("PETR4: desdobramento dobra a quantidade e divide o preco medio", () => {
    expect(petr?.quantidade).toBe("180.00000000");
    expect(petr?.preco_medio).toBe("18.026667");
    // O custo total nao muda no desdobramento: nao houve desembolso.
    expect(petr?.custo_total).toBe("3244.80");
  });

  it("PETR4: resultado realizado da venda parcial", () => {
    // 60 x (42,00 - 36,053333) - 6,00 de taxa
    expect(petr?.resultado_realizado).toBe("350.80");
  });

  it("PETR4: proventos somam os dois pagamentos", () => {
    // 150 x 0,80 + 180 x 0,45
    expect(petr?.proventos_recebidos).toBe("201.00");
  });

  it("VALE3: preco medio inclui a taxa de compra", () => {
    // (80 x 62 + 4 + 20 x 58 + 2) / 100
    expect(vale?.preco_medio).toBe("61.260000");
    expect(vale?.quantidade).toBe("50.00000000");
    expect(vale?.custo_total).toBe("3063.00");
  });

  it("VALE3: venda nao altera o preco medio", () => {
    // Recalcular a media na venda e o erro mais comum, e produziria resultado
    // errado em toda venda parcial seguinte.
    expect(vale?.preco_medio).toBe("61.260000");
    expect(vale?.resultado_realizado).toBe("182.00");
  });

  it("totais", () => {
    expect(r.resultado_realizado_total).toBe("532.80");
    expect(r.proventos_total).toBe("321.00");
    expect(r.taxas_total).toBe("25.00");
  });

  it("avaliacao a mercado", () => {
    const av = avaliar(r.posicoes, { PETR4: "21.50", VALE3: "58.00" });
    const p = av.find((x) => x.ticker === "PETR4");
    const v = av.find((x) => x.ticker === "VALE3");

    expect(p?.valor_de_mercado).toBe("3870.00");
    expect(p?.resultado_nao_realizado).toBe("625.20");
    expect(p?.rentabilidade).toBeCloseTo(0.192678, 6);

    expect(v?.valor_de_mercado).toBe("2900.00");
    expect(v?.resultado_nao_realizado).toBe("-163.00");
    expect(v?.rentabilidade).toBeCloseTo(-0.053216, 6);
  });

  it("posicao sem preco nao vira zero", () => {
    const av = avaliar(r.posicoes, { PETR4: "21.50" });
    const v = av.find((x) => x.ticker === "VALE3");
    expect(v?.valor_de_mercado).toBeNull();
    expect(v?.rentabilidade).toBeNull();
  });

  it("proventos por mes", () => {
    expect(proventosPorMes(CARTEIRA)).toEqual([
      { mes: "2024-03", valor: "120.00" },
      { mes: "2024-07", valor: "120.00" },
      { mes: "2024-10", valor: "81.00" },
    ]);
  });

  it("alocacao por ativo soma 1", () => {
    const av = avaliar(r.posicoes, { PETR4: "21.50", VALE3: "58.00" });
    const fatias = alocar(av, (p) => p.ticker);
    expect(fatias.map((f) => f.chave)).toEqual(["PETR4", "VALE3"]);
    const soma = fatias.reduce((acc, f) => acc + (f.fracao ?? 0), 0);
    expect(soma).toBeCloseTo(1, 6);
  });

  it("a ordem de entrada nao altera o resultado", () => {
    // A apuracao ordena por data: confiar na ordem de insercao seria um bug
    // silencioso quando o CSV vem fora de ordem.
    const invertida = apurar([...CARTEIRA].reverse());
    expect(invertida.resultado_realizado_total).toBe(r.resultado_realizado_total);
    expect(invertida.posicoes).toEqual(r.posicoes);
  });

  it("alocacao ignora posicao sem preco em vez de dilui-la", () => {
    const av = avaliar(r.posicoes, { PETR4: "21.50" });
    const fatias = alocar(av, (p) => p.ticker);
    expect(fatias).toHaveLength(1);
    expect(fatias[0]?.fracao).toBeCloseTo(1, 6);
  });
});

describe("ramos restantes da apuracao", () => {
  it("venda sem posicao realiza contra preco medio zero", () => {
    // Nao deve lancar: carteira importada pela metade pode ter venda sem a
    // compra correspondente, e o relatorio precisa sair de todo jeito.
    const r = apurar([
      {
        id: "1",
        ticker: "PETR4",
        tipo: "venda",
        data: "2024-01-01",
        quantidade: "10",
        preco: "30.00",
        taxas: "0",
      },
    ]);
    expect(r.posicoes[0]?.resultado_realizado).toBe("300.00");
    expect(r.posicoes[0]?.preco_medio).toBe("0.000000");
  });

  it("alocacao de carteira vazia e vazia", () => {
    expect(alocar([], (p) => p.ticker)).toEqual([]);
  });

  it("proventos de carteira sem provento e vazio", () => {
    expect(proventosPorMes([])).toEqual([]);
  });
});
