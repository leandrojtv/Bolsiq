import { describe, expect, it } from "vitest";
import type { LancamentoFinanceiro } from "@bolsiq/assistant/puro";
import { PainelGeral, PORTFOLIO_VAZIO } from "@bolsiq/finance/puro";
import { montarPainel, numerosDoMes } from "./painel-modelo";

const l = (o: Partial<LancamentoFinanceiro>): LancamentoFinanceiro => ({
  id: "x",
  data: "2026-11-05",
  descricao: "x",
  valor: "0",
  tipo: "despesa",
  status: "realizado",
  categoria: null,
  essencial: false,
  tipo_custo: null,
  aporte: false,
  origem: "Corrente",
  parcela: false,
  ...o,
});

const LANCAMENTOS = [
  l({ tipo: "receita", valor: "8000.00" }),
  l({ tipo: "receita", valor: "500.00", status: "previsto" }),
  l({ valor: "2500.00", categoria: "Moradia" }),
  l({ valor: "1100.00", categoria: "Mercado" }),
  l({ valor: "300.00", status: "previsto" }),
  l({ valor: "1000.00", categoria: "Investimentos (aporte)", aporte: true }),
];

describe("numeros do mes no painel", () => {
  it("renda e gastos realizados; aporte fica fora dos gastos e vira investido", () => {
    expect(numerosDoMes("2026-11", LANCAMENTOS)).toEqual({
      competencia: "2026-11",
      renda: "8000.00",
      despesas: "3600.00",
      taxa_de_poupanca: 55,
      investido: "1000.00",
    });
  });

  it("sem renda, sem taxa", () => {
    expect(numerosDoMes("2026-11", [l({ valor: "10" })]).taxa_de_poupanca).toBeNull();
  });
});

describe("montarPainel", () => {
  const entradas = {
    hoje: "2026-11-20",
    financas: { contas: "10000.00", faturas: "1200.00", dividas: "0.00" },
    portfolio: {
      ...PORTFOLIO_VAZIO,
      renda_variavel: "20000.00",
      carteiras: [{ id: "c1", nome: "Longo prazo", valor: "20000.00" }],
      avaliadas_em: "2026-11-20T15:00:00.000Z",
      sem_cotacao: ["XPTO3"],
    },
    fotos: [
      {
        mes: "2026-09",
        patrimonio_liquido: "25000.00",
        contas: "9000.00",
        investimentos: "17000.00",
        dividas: "1000.00",
      },
      {
        mes: "2026-10",
        patrimonio_liquido: "27000.00",
        contas: "9500.00",
        investimentos: "18500.00",
        dividas: "1000.00",
      },
    ],
    lancamentosDoMes: LANCAMENTOS,
    capacidade: {
      capacidade_mensal: "2100.00",
      sobra_media: "3000.00",
      meses_de_referencia: ["2026-08", "2026-09", "2026-10"],
      compromissos_futuros: { aumento_por_mes: "200.00" },
      reserva_de_emergencia: { separar_por_mes: "700.00" },
    },
    metas: [],
  };

  it("resposta valida no contrato, com o mes atual ao vivo no fim da serie", () => {
    const p = montarPainel(entradas);
    expect(PainelGeral.parse(p)).toEqual(p);
    expect(p.patrimonio.patrimonio_liquido).toBe("28800.00");
    expect(p.sem_cotacao).toEqual(["XPTO3"]);
    expect(p.evolucao.map((e) => [e.mes, e.patrimonio_liquido, e.parcial])).toEqual([
      ["2026-09", "25000.00", false],
      ["2026-10", "27000.00", false],
      ["2026-11", "28800.00", true],
    ]);
    expect(p.capacidade).toEqual({
      capacidade_mensal: "2100.00",
      sobra_media: "3000.00",
      aumento_das_parcelas: "200.00",
      separar_para_reserva: "700.00",
      meses_de_referencia: ["2026-08", "2026-09", "2026-10"],
    });
  });

  it("foto do mes corrente da lugar ao valor ao vivo; sem historico, sem capacidade", () => {
    const p = montarPainel({
      ...entradas,
      fotos: [{ ...entradas.fotos[1]!, mes: "2026-11" }],
      capacidade: null,
    });
    expect(p.evolucao).toHaveLength(1);
    expect(p.evolucao[0]?.parcial).toBe(true);
    expect(p.capacidade).toBeNull();
  });
});
