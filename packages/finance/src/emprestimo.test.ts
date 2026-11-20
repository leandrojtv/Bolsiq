import { describe, expect, it } from "vitest";
import {
  parcelaPrice,
  simularAmortizacao,
  saldoDevedor,
  somaDosJuros,
  tabela,
  tabelaPrice,
  tabelaSac,
} from "./emprestimo.js";

// Referencia: R$ 100.000, 1% a.m., 12 meses. Calculada a parte (Decimal do Python,
// arredondamento a centavos por linha, residuo na ultima) e conferida com a HP-12C
// para a parcela Price (8.884,88).
describe("Price", () => {
  const t = tabelaPrice("100000", "0.01", 12);
  it("parcela, juros, amortizacao e saldo", () => {
    expect(parcelaPrice("100000", "0.01", 12)).toBe("8884.88");
    expect(t[0]).toEqual({
      numero: 1,
      parcela: "8884.88",
      juros: "1000.00",
      amortizacao: "7884.88",
      saldo: "92115.12",
    });
    expect(t[1]).toMatchObject({
      juros: "921.15",
      amortizacao: "7963.73",
      saldo: "84151.39",
    });
    expect(t[11]).toMatchObject({ parcela: "8884.85", juros: "87.97", saldo: "0.00" });
    expect(somaDosJuros(t)).toBe("6618.53");
  });
  it("sem juros divide o principal", () => {
    expect(parcelaPrice("1000", "0", 4)).toBe("250.00");
    expect(tabelaPrice("1000", "0", 4).map((l) => l.juros)).toEqual(
      Array(4).fill("0.00"),
    );
  });
});

describe("SAC", () => {
  const t = tabelaSac("100000", "0.01", 12);
  it("amortizacao constante e juros decrescentes", () => {
    expect(t[0]).toMatchObject({
      parcela: "9333.33",
      juros: "1000.00",
      amortizacao: "8333.33",
    });
    expect(t[1]).toMatchObject({
      parcela: "9250.00",
      juros: "916.67",
      saldo: "83333.34",
    });
    expect(t[11]).toMatchObject({
      parcela: "8416.70",
      amortizacao: "8333.37",
      saldo: "0.00",
    });
    expect(somaDosJuros(t)).toBe("6500.00");
    expect(tabela("sac", "100000", "0.01", 12)).toEqual(t);
  });
});

describe("amortizacao extra", () => {
  it("Price reduzindo prazo mantem a parcela e economiza juros", () => {
    const s = simularAmortizacao({
      sistema: "price",
      saldo_devedor: "100000",
      taxa: "0.01",
      parcelas_restantes: 12,
      extra: "20000",
      modo: "reduzir_prazo",
    });
    expect(s.antes).toEqual({
      parcelas: 12,
      primeira_parcela: "8884.88",
      juros: "6618.53",
    });
    expect(s.depois.parcelas).toBe(10);
    expect(s.depois.primeira_parcela).toBe("8884.88");
    expect(Number(s.juros_economizados)).toBeGreaterThan(0);
    expect(s.tabela.at(-1)?.saldo).toBe("0.00");
  });
  it("Price reduzindo parcela mantem o prazo", () => {
    const s = simularAmortizacao({
      sistema: "price",
      saldo_devedor: "100000",
      taxa: "0.01",
      parcelas_restantes: 12,
      extra: "20000",
      modo: "reduzir_parcela",
    });
    expect(s.depois).toMatchObject({
      parcelas: 12,
      primeira_parcela: parcelaPrice("80000", "0.01", 12),
    });
    expect(s.juros_economizados).toBe(
      (
        Number(s.antes.juros) - Number(somaDosJuros(tabelaPrice("80000", "0.01", 12)))
      ).toFixed(2),
    );
  });
  it("SAC reduzindo prazo mantem a amortizacao; extra que quita zera tudo", () => {
    const s = simularAmortizacao({
      sistema: "sac",
      saldo_devedor: "100000",
      taxa: "0.01",
      parcelas_restantes: 12,
      extra: "25000",
      modo: "reduzir_prazo",
    });
    expect(s.depois.parcelas).toBe(9);
    expect(s.tabela[0]?.amortizacao).toBe("8333.33");
    const quita = simularAmortizacao({
      sistema: "sac",
      saldo_devedor: "1000",
      taxa: "0.01",
      parcelas_restantes: 3,
      extra: "1000",
      modo: "reduzir_parcela",
    });
    expect(quita.depois).toEqual({
      parcelas: 0,
      primeira_parcela: "0.00",
      juros: "0.00",
    });
    expect(quita.juros_economizados).toBe(quita.antes.juros);
  });
});

describe("saldo devedor pelo historico", () => {
  it("parcelas pagas e amortizacao extra", () => {
    const t = tabelaPrice("100000", "0.01", 12);
    const pagas = t.slice(0, 2).map((l, k) => ({
      data: `2024-0${k + 1}-10`,
      tipo: "parcela" as const,
      valor: l.parcela,
    }));
    expect(saldoDevedor("100000", "0.01", pagas)).toBe("84151.39");
    expect(
      saldoDevedor("100000", "0.01", [
        ...pagas,
        { data: "2024-02-20", tipo: "extra", valor: "4151.39" },
      ]),
    ).toBe("80000.00");
    expect(
      saldoDevedor("100", "0", [{ data: "2024-01-01", tipo: "extra", valor: "500" }]),
    ).toBe("0.00");
  });
});
