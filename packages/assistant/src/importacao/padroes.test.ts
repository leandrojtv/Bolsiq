import { describe, expect, it } from "vitest";
import {
  NUNCA_INVENTAR,
  POLITICA_DE_PREENCHIMENTO,
  preencherPosicao,
  preencherTransacao,
} from "./padroes.js";

const ctx = {
  data_documento: "2026-10-31",
  hoje: "2026-11-08",
  corretora_escolhida: "XP",
  nome_do_arquivo: "x.pdf",
};

describe("politica de preenchimento", () => {
  it("ir e iof viram 0; saldo liquido e saldo - ir - iof", () => {
    const r = preencherPosicao({ classe: "fundo", saldo_bruto: "1000", ir: "15" }, ctx);
    expect(r.dados).toMatchObject({ ir: "15", iof: "0", saldo_liquido: "985.00" });
    expect(r.preenchidos).toContain("iof");
    expect(r.preenchidos).not.toContain("ir");
  });

  it("quantidade 1 em renda fixa, COE e estruturado; nunca em renda variavel", () => {
    for (const classe of ["renda_fixa", "coe", "estruturado"])
      expect(preencherPosicao({ classe, saldo_bruto: "10" }, ctx).dados.quantidade).toBe(
        "1",
      );
    for (const classe of ["acao", "fii", "bdr", "etf"]) {
      const r = preencherPosicao({ classe, saldo_bruto: "10" }, ctx);
      expect(r.dados.quantidade).toBeUndefined();
      expect(r.preenchidos).not.toContain("quantidade");
    }
  });

  it("preco unitario pelo saldo e quantidade; valor aplicado pelo saldo, com aviso", () => {
    const r = preencherPosicao(
      { classe: "fundo", saldo_bruto: "1000", quantidade: "4" },
      ctx,
    );
    expect(r.dados).toMatchObject({ preco_unitario: "250", valor_aplicado: "1000.00" });
    expect(r.avisos).toEqual([
      "Sem valor aplicado no documento: rentabilidade não calculável.",
    ]);
    expect(
      preencherPosicao(
        { classe: "fundo", saldo_bruto: "1000", valor_aplicado: "900" },
        ctx,
      ).avisos,
    ).toEqual([]);
  });

  it("data do documento; sem ela, a do envio", () => {
    expect(
      preencherPosicao({ classe: "coe", saldo_bruto: "1" }, ctx).dados.data_posicao,
    ).toBe("2026-10-31");
    expect(
      preencherPosicao(
        { classe: "coe", saldo_bruto: "1" },
        { ...ctx, data_documento: "" },
      ).dados.data_posicao,
    ).toBe("2026-11-08");
  });

  it("corretora escolhida; sem ela, o nome do arquivo", () => {
    expect(
      preencherPosicao({ classe: "coe", saldo_bruto: "1" }, ctx).dados.corretora,
    ).toBe("XP");
    expect(
      preencherPosicao(
        { classe: "coe", saldo_bruto: "1" },
        { ...ctx, corretora_escolhida: "", nome_do_arquivo: "Extrato_Rico[out].pdf" },
      ).dados.corretora,
    ).toBe("Extrato Rico out");
  });

  it("liquidez N e valorizacao pela classe", () => {
    const r = preencherPosicao({ classe: "titulo_publico", saldo_bruto: "1" }, ctx);
    expect(r.dados).toMatchObject({ liquidez_diaria: "N", valorizacao: "tesouro" });
    expect(
      preencherPosicao({ classe: "coe", saldo_bruto: "1" }, ctx).dados.valorizacao,
    ).toBe("manual");
  });

  it("nunca inventa saldo nem codigo: sem saldo, nada derivado dele", () => {
    const r = preencherPosicao({ classe: "renda_fixa" }, ctx);
    expect(r.dados.saldo_bruto).toBeUndefined();
    expect(r.dados.preco_unitario).toBeUndefined();
    expect(r.dados.codigo).toBeUndefined();
    expect(NUNCA_INVENTAR).toContain("saldo_bruto");
    expect(POLITICA_DE_PREENCHIMENTO.length).toBe(10);
  });

  it("transacao: so taxas e corretora; preco, data, ticker e quantidade nunca", () => {
    const r = preencherTransacao(
      { ticker: "", preco: "", data: "", quantidade: "" },
      ctx,
    );
    expect(r.dados).toEqual({
      ticker: "",
      preco: "",
      data: "",
      quantidade: "",
      taxas: "0",
      corretora: "XP",
    });
    expect(r.preenchidos).toEqual(["taxas", "corretora"]);
  });
});
