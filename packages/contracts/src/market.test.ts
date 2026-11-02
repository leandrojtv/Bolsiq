import { describe, expect, it } from "vitest";
import {
  Asset,
  AssetKind,
  FinancialStatementLine,
  FundDaily,
  HealthResponse,
  MacroSeriesPoint,
  Quote,
  StatementType,
} from "./market.js";

const provenance = {
  source: "b3-cotahist",
  fetched_at: "2026-10-31T22:14:03Z",
  license: "proprietária — B3",
  source_ref: "COTAHIST_A2026.ZIP",
};

describe("Asset", () => {
  const base = {
    ticker: "PETR4",
    isin: "BRPETRACNPR6",
    cnpj: "33000167000101",
    cvm_code: "9512",
    name: "Petrobras",
    legal_name: "Petróleo Brasileiro S.A.",
    kind: "stock" as const,
    sector: "Petróleo e Gás",
    status: "ATIVO",
  };

  it("aceita um ativo completo", () => {
    expect(Asset.parse(base)).toEqual(base);
  });

  it("permite nulo nos identificadores que uma fonte só não traz", () => {
    // O cadastro da CVM não traz ticker; o COTAHIST não traz CNPJ.
    expect(Asset.parse({ ...base, ticker: null, isin: null })).toMatchObject({
      ticker: null,
    });
    expect(Asset.parse({ ...base, cnpj: null, cvm_code: null })).toMatchObject({
      cnpj: null,
    });
  });

  it("exige nome", () => {
    expect(() => Asset.parse({ ...base, name: undefined })).toThrow();
  });

  it("recusa tipo de ativo fora da lista", () => {
    expect(() => Asset.parse({ ...base, kind: "cripto" })).toThrow();
    expect(AssetKind.options).toContain("fii");
  });
});

describe("Quote", () => {
  const base = {
    ticker: "PETR4",
    date: "2026-10-31",
    open: "38.00",
    high: "39.00",
    low: "37.50",
    close: "38.42",
    average: "38.25",
    adj_close: null,
    volume: 9876543,
    trades: 1234,
    financial_volume: "3794820.00",
    provenance,
  };

  it("aceita uma cotação completa", () => {
    expect(Quote.parse(base)).toEqual(base);
  });

  it("recusa preço como number", () => {
    // Regra 5: moeda nunca passa por float.
    expect(() => Quote.parse({ ...base, close: 38.42 })).toThrow();
  });

  it("exige proveniência", () => {
    expect(() => Quote.parse({ ...base, provenance: undefined })).toThrow();
  });

  it("aceita adj_close preenchido quando já houve ajuste", () => {
    expect(Quote.parse({ ...base, adj_close: "37.90" }).adj_close).toBe("37.90");
  });

  it("recusa volume negativo", () => {
    expect(() => Quote.parse({ ...base, volume: -1 })).toThrow();
  });
});

describe("FundDaily", () => {
  const base = {
    cnpj_fundo: "12345678000195",
    date: "2026-10-31",
    nav: "1.234567",
    aum: "150000000.00",
    inflows: "250000.00",
    outflows: "100000.00",
    holders: 4821,
    provenance: { ...provenance, source: "cvm-fundos", license: "ODbL-1.0" },
  };

  it("aceita um informe diário", () => {
    expect(FundDaily.parse(base)).toEqual(base);
  });

  it("permite nulo em captação, resgate e cotistas", () => {
    expect(
      FundDaily.parse({ ...base, inflows: null, outflows: null, holders: null }),
    ).toMatchObject({ inflows: null, holders: null });
  });

  it("exige CNPJ normalizado", () => {
    expect(() =>
      FundDaily.parse({ ...base, cnpj_fundo: "12.345.678/0001-95" }),
    ).toThrow();
  });
});

describe("FinancialStatementLine", () => {
  const base = {
    cvm_code: "9512",
    cnpj: "33000167000101",
    reference_date: "2023-12-31",
    period_start: "2023-01-01",
    period_end: "2023-12-31",
    statement_type: "DRE" as const,
    is_consolidated: true,
    account_code: "3.01",
    account_label: "Receita de Venda de Bens e/ou Serviços",
    amount: "511000000000.00",
    currency: "REAL",
    version: 1,
    provenance: { ...provenance, source: "cvm-dfp", license: "ODbL-1.0" },
  };

  it("aceita uma linha de demonstrativo", () => {
    expect(FinancialStatementLine.parse(base)).toEqual(base);
  });

  it("permite período nulo no balanço, que é posição e não fluxo", () => {
    expect(
      FinancialStatementLine.parse({
        ...base,
        statement_type: "BPA",
        period_start: null,
        period_end: null,
      }),
    ).toMatchObject({ period_start: null });
  });

  it("exige versão positiva", () => {
    expect(() => FinancialStatementLine.parse({ ...base, version: 0 })).toThrow();
    expect(() => FinancialStatementLine.parse({ ...base, version: 1.5 })).toThrow();
  });

  it("recusa tipo de demonstrativo desconhecido", () => {
    expect(() =>
      FinancialStatementLine.parse({ ...base, statement_type: "XPTO" }),
    ).toThrow();
    expect(StatementType.options).toContain("DFC");
  });
});

describe("MacroSeriesPoint", () => {
  const base = {
    series_code: "12",
    date: "2026-10-29",
    value: "0.050788",
    unit: "% no dia útil",
    frequency: "daily" as const,
    provenance: { ...provenance, source: "bcb-sgs", license: "aberta" },
  };

  it("aceita um ponto de série", () => {
    expect(MacroSeriesPoint.parse(base)).toEqual(base);
  });

  it("aceita frequência mensal e recusa outras", () => {
    expect(MacroSeriesPoint.parse({ ...base, frequency: "monthly" }).frequency).toBe(
      "monthly",
    );
    expect(() => MacroSeriesPoint.parse({ ...base, frequency: "weekly" })).toThrow();
  });
});

describe("HealthResponse", () => {
  it("aceita ok e degraded", () => {
    expect(
      HealthResponse.parse({
        status: "ok",
        role: "all",
        version: "1.2.3",
        checks: { database: "ok" },
      }).status,
    ).toBe("ok");

    expect(
      HealthResponse.parse({
        status: "degraded",
        role: "worker",
        version: "1.2.3",
        checks: { database: "fail" },
      }).checks.database,
    ).toBe("fail");
  });

  it("recusa papel e status fora do contrato", () => {
    const base = { status: "ok", role: "all", version: "1", checks: {} };
    expect(() => HealthResponse.parse({ ...base, role: "api-gateway" })).toThrow();
    expect(() => HealthResponse.parse({ ...base, status: "down" })).toThrow();
    expect(() => HealthResponse.parse({ ...base, checks: { db: "talvez" } })).toThrow();
  });
});
