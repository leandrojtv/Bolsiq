import { describe, expect, it } from "vitest";
import {
  classe,
  data,
  fracao,
  indexador,
  liquidez,
  normalizarPosicao,
  normalizarTransacao,
  numero,
  PARECE_TOTAL,
  ticker,
  vazio,
} from "./normalizar.js";

describe("normalizacao deterministica", () => {
  it("numero: R$, milhar, virgula decimal, negativo, porcento", () => {
    expect(numero("R$ 1.234,56")).toBe("1234.56");
    expect(numero("1,234,567.89")).toBe("1234567.89");
    expect(numero("1.234.567")).toBe("1234567");
    expect(numero("37,85")).toBe("37.85");
    expect(numero("1234.5")).toBe("1234.5");
    expect(numero("(1.234,56)")).toBe("-1234.56");
    expect(numero("-10")).toBe("-10");
    expect(numero("12,5%")).toBe("12.5");
    expect(numero("—")).toBe("");
    expect(numero("abc")).toBe("abc");
  });

  it("fracao: percentual vira fracao, fracao fica", () => {
    expect(fracao("110%", 5)).toBe("1.1");
    expect(fracao("110", 5)).toBe("1.1");
    expect(fracao("1.10", 5)).toBe("1.10");
    expect(fracao("14,69%", 1)).toBe("0.1469");
    expect(fracao("0.1469", 1)).toBe("0.1469");
    expect(fracao("", 1)).toBe("");
  });

  it("data: DD/MM/AAAA, DD-MM-AA, ISO e por extenso", () => {
    expect(data("15/05/2045")).toBe("2045-05-15");
    expect(data("5/3/26")).toBe("2026-03-05");
    expect(data("2026-10-31T00:00:00")).toBe("2026-10-31");
    expect(data("15 mai 2045")).toBe("2045-05-15");
    expect(data("15 de maio de 2045")).toBe("2045-05-15");
    expect(data("mai/2045")).toBe("2045-05-01");
    expect(data("-")).toBe("");
    expect(data("amanhã")).toBe("amanhã");
  });

  it("vazios, ticker, classe por sinonimo, indexador e liquidez", () => {
    for (const v of ["-", "—", "–", "N/A", "", "  "]) expect(vazio(v)).toBe(true);
    expect(ticker(" petr 4 ")).toBe("PETR4");
    expect(classe("CDB")).toBe("renda_fixa");
    expect(classe("LCI")).toBe("renda_fixa");
    expect(classe("", "LCA Banco X 2027")).toBe("renda_fixa");
    expect(classe("Tesouro Direto")).toBe("titulo_publico");
    expect(classe("", "NTN-B 2035")).toBe("titulo_publico");
    expect(classe("LFT")).toBe("titulo_publico");
    expect(classe("VGBL")).toBe("previdencia");
    expect(classe("PGBL")).toBe("previdencia");
    expect(classe("FIDC")).toBe("fundo");
    expect(classe("FIC FIM")).toBe("fundo");
    expect(classe("Fundos Imobiliários")).toBe("fii");
    expect(classe("Ações")).toBe("acao");
    expect(classe("coe")).toBe("coe");
    expect(classe("xyz")).toBe("xyz");
    expect(indexador("% do CDI")).toBe("CDI");
    expect(indexador("IPCA+")).toBe("IPCA");
    expect(indexador("Prefixado")).toBe("PRE");
    expect(indexador("")).toBe("");
    expect(liquidez("Diária")).toBe("S");
    expect(liquidez("Não")).toBe("N");
    expect(liquidez("No vencimento")).toBe("N");
  });

  it("posicao e transacao inteiras", () => {
    expect(
      normalizarPosicao({
        classe: "Ações",
        codigo: "petr4f",
        saldo_bruto: "R$ 3.842,00",
        cnpj: "12.345.678/0001-90",
        data_posicao: "31/10/2026",
        ir: "-",
      }),
    ).toEqual({
      classe: "acao",
      codigo: "PETR4",
      saldo_bruto: "3842.00",
      cnpj: "12345678000190",
      data_posicao: "2026-10-31",
      ir: "",
    });
    expect(
      normalizarTransacao({
        data: "03/10/2026",
        ticker: "itub4f",
        tipo: "C",
        quantidade: "1.000",
        preco: "35,10",
        taxas: "—",
      }),
    ).toEqual({
      data: "2026-10-03",
      ticker: "ITUB4",
      tipo: "compra",
      quantidade: "1.000",
      preco: "35.10",
      taxas: "",
    });
  });

  it("reconhece linha de total", () => {
    for (const t of [
      "Total",
      "Total geral",
      "Subtotal Renda Fixa",
      "Patrimônio total",
      "Saldo total",
    ])
      expect(PARECE_TOTAL.test(t)).toBe(true);
    expect(PARECE_TOTAL.test("Totvs ON")).toBe(false);
  });
});
