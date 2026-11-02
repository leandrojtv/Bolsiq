import { Decimal } from "decimal.js";

export interface LinhaDeConta {
  statementType: string;
  accountCode: string;
  accountLabel: string;
  amount: string;
}

/** Contas usadas pelos indicadores, em reais. Nula quando a fonte nao traz. */
export interface ResumoContabil {
  revenue: string | null;
  gross_profit: string | null;
  ebit: string | null;
  net_income: string | null;
  depreciation_amortization: string | null;
  total_assets: string | null;
  current_assets: string | null;
  cash_and_equivalents: string | null;
  current_liabilities: string | null;
  equity: string | null;
  gross_debt: string | null;
}

/** Conta fixa do plano da CVM para cada campo. */
const CONTA_FIXA = {
  revenue: ["DRE", "3.01"],
  gross_profit: ["DRE", "3.03"],
  ebit: ["DRE", "3.05"],
  net_income: ["DRE", "3.11"],
  total_assets: ["BPA", "1"],
  current_assets: ["BPA", "1.01"],
  cash_and_equivalents: ["BPA", "1.01.01"],
  current_liabilities: ["BPP", "2.01"],
  equity: ["BPP", "2.03"],
} as const;

/** Emprestimos e financiamentos, circulante e nao circulante. */
const CONTAS_DE_DIVIDA = ["2.01.04", "2.02.01"];

const DEPRECIACAO = /deprecia|amortiza|exaust|deple/i;

/**
 * Resume as linhas de um demonstrativo (uma companhia, uma data-base) nas
 * contas que os indicadores usam.
 *
 * Depreciacao nao tem conta fixa: cada companhia abre o ajuste do fluxo de
 * caixa indireto (6.01.01.xx) com o proprio rotulo, e algumas separam
 * depreciacao de amortizacao em duas linhas. Por isso soma toda linha de
 * 6.01.01 cujo rotulo fala de depreciacao, amortizacao, exaustao ou deplecao.
 * Fora de 6.01.01, "amortizacao" e pagamento de divida (6.03), nao despesa.
 */
export function resumirContas(linhas: LinhaDeConta[]): ResumoContabil {
  const porConta = new Map<string, string>();
  for (const l of linhas) {
    porConta.set(`${l.statementType}|${l.accountCode}`, l.amount);
  }

  const fixa = (campo: keyof typeof CONTA_FIXA): string | null => {
    const [tipo, conta] = CONTA_FIXA[campo];
    return porConta.get(`${tipo}|${conta}`) ?? null;
  };

  const divida = somar(
    CONTAS_DE_DIVIDA.map((c) => porConta.get(`BPP|${c}`)).filter(
      (v): v is string => v !== undefined,
    ),
  );

  const depreciacao = somar(
    linhas
      .filter(
        (l) =>
          l.statementType === "DFC" &&
          l.accountCode.startsWith("6.01.01.") &&
          DEPRECIACAO.test(l.accountLabel),
      )
      .map((l) => l.amount),
  );

  return {
    revenue: fixa("revenue"),
    gross_profit: fixa("gross_profit"),
    ebit: fixa("ebit"),
    net_income: fixa("net_income"),
    depreciation_amortization: depreciacao,
    total_assets: fixa("total_assets"),
    current_assets: fixa("current_assets"),
    cash_and_equivalents: fixa("cash_and_equivalents"),
    current_liabilities: fixa("current_liabilities"),
    equity: fixa("equity"),
    gross_debt: divida,
  };
}

function somar(valores: string[]): string | null {
  if (valores.length === 0) return null;
  return valores.reduce((acc, v) => acc.plus(v), new Decimal(0)).toFixed();
}
