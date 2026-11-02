import { describe, expect, it } from "vitest";
import { resumirContas, type LinhaDeConta } from "./contas.js";

const l = (
  statementType: string,
  accountCode: string,
  amount: string,
  accountLabel = "x",
) => ({ statementType, accountCode, accountLabel, amount }) satisfies LinhaDeConta;

/** Linhas reais do DFP 2024 consolidado da Petrobras, em reais. */
const PETROBRAS: LinhaDeConta[] = [
  l("DRE", "3.01", "490829000000"),
  l("DRE", "3.03", "246462000000"),
  l("DRE", "3.05", "137201000000"),
  l("DRE", "3.11", "37009000000"),
  l("BPA", "1", "1124797000000"),
  l("BPA", "1.01", "135212000000"),
  l("BPA", "1.01.01", "20254000000"),
  l("BPP", "2.01", "194808000000"),
  l("BPP", "2.03", "367514000000"),
  l("BPP", "2.01.04", "68783000000"),
  l("BPP", "2.02.01", "304684000000"),
  l("DFC", "6.01.01.04", "67033000000", "Depreciação, depleção e amortização"),
  l("DFC", "6.03.03", "-35933000000", "Amortizações de principal - financiamentos"),
];

describe("resumirContas", () => {
  it("mapeia as contas fixas e soma a divida", () => {
    const r = resumirContas(PETROBRAS);
    expect(r.revenue).toBe("490829000000");
    expect(r.net_income).toBe("37009000000");
    expect(r.equity).toBe("367514000000");
    expect(r.gross_debt).toBe("373467000000");
  });

  it("depreciacao vem so do ajuste operacional, nao da amortizacao de divida", () => {
    expect(resumirContas(PETROBRAS).depreciation_amortization).toBe("67033000000");
  });

  it("soma depreciacao e amortizacao quando vem em linhas separadas", () => {
    const r = resumirContas([
      l("DFC", "6.01.01.02", "100", "Depreciação"),
      l("DFC", "6.01.01.03", "50.5", "Amortização de intangível"),
      l("DFC", "6.01.01.04", "999", "Provisões"),
    ]);
    expect(r.depreciation_amortization).toBe("150.5");
  });

  it("conta ausente e nula, nao zero", () => {
    const r = resumirContas([l("DRE", "3.01", "10")]);
    expect(r.gross_profit).toBeNull();
    expect(r.gross_debt).toBeNull();
    expect(r.depreciation_amortization).toBeNull();
  });
});
