import { describe, expect, it } from "vitest";
import type {
  Candle,
  Dividend,
  FiiMonthlyReport,
  FundamentalsPeriod,
} from "@bolsiq/contracts";
import { DFP_2024 } from "./cvm.fixtures.js";
import {
  acoesNaEscalaCerta,
  demonstrativoDe,
  proventos12m,
  proventosPorAno,
  recalcular,
  rendimentoFii12m,
  type DadosDoAtivo,
} from "./recalculo.js";

const petr = DFP_2024.PETR4.demonstrativo;

const periodo: FundamentalsPeriod = {
  reference_date: "2024-12-31",
  period_start: "2024-01-01",
  statement_kind: "DFP",
  consolidated: true,
  revenue: petr.receita,
  gross_profit: petr.resultado_bruto,
  ebit: petr.ebit,
  net_income: petr.lucro_liquido,
  depreciation_amortization: petr.depreciacao_amortizacao,
  total_assets: petr.ativo_total,
  current_assets: petr.ativo_circulante,
  cash_and_equivalents: petr.caixa_equivalentes,
  current_liabilities: petr.passivo_circulante,
  equity: petr.patrimonio_liquido,
  gross_debt: petr.divida_bruta,
  shares_outstanding: DFP_2024.PETR4.acoes,
  version: 1,
};

function velas(n: number, inicio = 30): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const dia = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    const close = String(inicio + (i % 5));
    return {
      date: dia,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1000,
      financial_volume: "1000000",
    };
  });
}

const div = (
  ex_date: string,
  v: string,
  kind: Dividend["kind"] = "dividendo",
): Dividend => ({
  ticker: "PETR4",
  kind,
  ex_date,
  payment_date: null,
  approved_on: null,
  value_per_share: v,
  factor: null,
  ratio: null,
});

function dados(sobre: Partial<DadosDoAtivo> = {}): DadosDoAtivo {
  const v = velas(60);
  return {
    ticker: "PETR4",
    kind: "stock",
    anuais: [periodo],
    velasBrutas: v,
    velasAjustadas: v,
    proventos: [
      div("2025-11-01", "1.5"),
      div("2025-05-01", "1", "jcp"),
      div("2023-05-01", "2"),
    ],
    cdi: v.map((x) => ({ date: x.date, value: "0.05" })),
    ibov: v.map((x, i) => ({ date: x.date, value: String(100 + (i % 3)) })),
    hoje: "2026-03-01",
    ...sobre,
  };
}

describe("proventos", () => {
  const lista = [
    div("2025-11-01", "1.5"),
    div("2025-05-01", "1", "jcp"),
    div("2023-05-01", "2"),
  ];

  it("12 meses soma dividendo e JCP dentro da janela", () => {
    expect(proventos12m(lista, "2026-03-01")).toBe("2.5");
    expect(
      proventos12m(
        [{ ...div("2026-01-01", "1"), kind: "desdobramento", value_per_share: null }],
        "2026-03-01",
      ),
    ).toBe("0");
  });

  it("por ano comeca no primeiro ano com provento", () => {
    expect(proventosPorAno(lista, "2026-03-01")).toEqual(["2", "0", "2.5"]);
    expect(proventosPorAno([], "2026-03-01")).toEqual([]);
  });
});

describe("acoesNaEscalaCerta", () => {
  it("mantem a quantidade que a CVM informou em unidades", () => {
    // Petrobras: 12,9 bi de acoes a R$ 30, PL de 367 bi. P/VP ~1,05.
    expect(acoesNaEscalaCerta(12_888_732_761, "30", "367514000000")).toBe(12_888_732_761);
  });

  it("multiplica por mil a quantidade informada em milhares", () => {
    // Cyrela no DFP 2025: 366.311 (milhares), PL de 11,5 bi, preco ~R$ 20.
    expect(acoesNaEscalaCerta(366_311, "20", "11466784000")).toBe(366_311_000);
  });

  it("sem escala plausivel, ou patrimonio negativo, devolve null", () => {
    expect(acoesNaEscalaCerta(10, "1", "1000000000000")).toBeNull();
    expect(acoesNaEscalaCerta(1_000_000, "10", "-5")).toBeNull();
  });
});

describe("demonstrativoDe", () => {
  it("exige as contas sem as quais nao ha indicador", () => {
    expect(demonstrativoDe({ ...periodo, net_income: null })).toBeNull();
  });

  it("conta de soma ausente vale zero", () => {
    const d = demonstrativoDe({ ...periodo, gross_debt: null, gross_profit: null });
    expect(d?.divida_bruta).toBe("0");
    expect(d?.resultado_bruto).toBe("0");
  });
});

describe("recalcular", () => {
  it("acao com DFP calcula valuation sobre a data do demonstrativo", () => {
    const r = recalcular(dados());
    expect(r?.reference_date).toBe("2024-12-31");
    expect(r?.fonte_demonstrativo).toBe("cvm-dfp:2024-12-31:v1");
    // LPA conferido contra o DFP em cvm.test.ts: 2.871423.
    expect(Number(r?.lpa)).toBeCloseTo(2.871423, 5);
    expect(Number(r?.pl)).toBeGreaterThan(0);
    expect(r?.sharpe).not.toBeNull();
    expect(r?.beta).not.toBeNull();
    expect(r?.liquidez_diaria).toBe("1000000.00");
  });

  it("anula margem bruta e liquidez quando a conta nao existe", () => {
    const r = recalcular(
      dados({ anuais: [{ ...periodo, gross_profit: null, current_assets: null }] }),
    );
    expect(r?.margem_bruta).toBeNull();
    expect(r?.liquidez_corrente).toBeNull();
    expect(r?.roe).not.toBeNull();
  });

  it("sem demonstrativo calcula so preco e provento", () => {
    const r = recalcular(dados({ kind: "fii", anuais: [] }));
    expect(r?.reference_date).toBe(velas(60).at(-1)?.date);
    expect(r?.pl).toBeUndefined();
    expect(Number(r?.dy_12m)).toBeGreaterThan(0);
    expect(r?.fonte_demonstrativo).toBeNull();
  });

  it("sem acoes em circulacao cai no caminho sem demonstrativo", () => {
    const r = recalcular(dados({ anuais: [{ ...periodo, shares_outstanding: null }] }));
    expect(r?.fonte_demonstrativo).toBeNull();
  });

  it("acoes em milhares nao produzem P/L perto de zero", () => {
    const emMilhares = Math.round(DFP_2024.PETR4.acoes / 1000);
    const r = recalcular(
      dados({ anuais: [{ ...periodo, shares_outstanding: emMilhares }] }),
    );
    expect(Number(r?.pl)).toBeGreaterThan(5);
  });

  it("sem preco nao ha indicador", () => {
    expect(recalcular(dados({ velasBrutas: [] }))).toBeNull();
  });

  it("serie curta ou sem macro deixa sharpe e beta nulos", () => {
    const r = recalcular(dados({ cdi: [], ibov: [], proventos: [] }));
    expect(r?.sharpe).toBeNull();
    expect(r?.beta).toBeNull();
  });

  it("razao absurda vira nulo em vez de estourar o numeric", () => {
    // EBIT de R$ 1 com EV de centenas de bilhoes: EV/EBIT passa de 10^11.
    const r = recalcular(dados({ anuais: [{ ...periodo, ebit: "1" }] }));
    expect(r?.ev_ebit).toBeNull();
    expect(r?.pl).not.toBeNull();
  });
});

/** Informe de FII: VP 40, DY 1% ao mes. */
function informe(
  reference_date: string,
  sobre: Partial<FiiMonthlyReport> = {},
): FiiMonthlyReport {
  return {
    reference_date,
    version: 1,
    total_assets: "1100000000",
    equity: "1000000000",
    shares_outstanding: "25000000",
    nav_per_share: "40",
    holders: 150000,
    dividend_yield_month: "0.01",
    effective_return_month: "0.01",
    amortization_month: "0",
    dividends_payable: null,
    provenance: {
      source: "cvm-fii-mensal",
      fetched_at: "2026-10-20T00:00:00.000Z",
      license: "ODbL-1.0",
      source_ref: "inf_mensal_fii_2026.zip#inf_mensal_fii_geral",
    },
    ...sobre,
  };
}

/** 2024-09 (fora da janela) e de 2025-10 a 2026-09, com marco negativo. */
const informes = [
  informe("2024-09-01", { dividend_yield_month: "0.5" }),
  ...Array.from({ length: 12 }, (_, i) => {
    const mes = new Date(Date.UTC(2025, 9 + i, 1)).toISOString().slice(0, 10);
    return informe(mes, mes === "2026-03-01" ? { dividend_yield_month: "-0.05" } : {});
  }),
].reverse();

describe("FII pelo informe mensal", () => {
  it("rendimento de 12 meses ate a ultima competencia, sem mes negativo", () => {
    // 11 meses de 1% sobre VP 40; a ordem de entrada nao importa.
    expect(rendimentoFii12m(informes)).toBe("4.4");
    expect(rendimentoFii12m([])).toBeNull();
    expect(rendimentoFii12m([informe("2026-09-01", { nav_per_share: null })])).toBeNull();
  });

  it("calcula P/VP, patrimonio, cotistas e DY pelo informe sem proventos da brapi", () => {
    const r = recalcular(
      dados({
        ticker: "HGLG11",
        kind: "fii",
        anuais: [],
        proventos: [],
        informesFii: informes,
      }),
    );
    // Preco 34 (ultima vela) sobre VP 40.
    expect(Number(r?.pvp)).toBeCloseTo(0.85, 6);
    expect(r?.vpa).toBe("40");
    expect(r?.patrimonio_liquido).toBe("1000000000");
    expect(r?.cotistas).toBe(150000);
    expect(Number(r?.dy_12m)).toBeCloseTo(4.4 / 34, 6);
    expect(r?.fonte_demonstrativo).toBe("cvm-fii-mensal:2026-09-01:v1");
  });

  it("com proventos da brapi, o DY 12m continua sendo o da brapi", () => {
    const comBrapi = recalcular(
      dados({ kind: "fii", anuais: [], informesFii: informes }),
    );
    const semInforme = recalcular(dados({ kind: "fii", anuais: [] }));
    expect(comBrapi?.dy_12m).toBe(semInforme?.dy_12m);
    expect(Number(comBrapi?.pvp)).toBeCloseTo(0.85, 6);
  });

  it("sem informe, FII fica sem P/VP e acao nao usa informe", () => {
    const fii = recalcular(dados({ kind: "fii", anuais: [], proventos: [] }));
    expect(fii?.pvp).toBeUndefined();
    expect(Number(fii?.dy_12m)).toBe(0);
    const acao = recalcular(dados({ informesFii: informes }));
    expect(acao?.fonte_demonstrativo).toMatch(/^cvm-dfp:/);
  });
});
