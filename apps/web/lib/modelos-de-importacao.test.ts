import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  importarCsvBolsiq,
  importarExtratoB3,
  importarPosicaoBolsiq,
} from "@bolsiq/portfolio";

const modelo = (nome: string) =>
  readFileSync(resolve(import.meta.dirname, "../public/modelos", nome), "utf8");

describe("modelos de importacao (#45)", () => {
  it("transacoes no CSV Bolsiq importam sem rejeicao", () => {
    const r = importarCsvBolsiq(modelo("transacoes-bolsiq.csv"));
    expect(r.rejeicoes).toEqual([]);
    expect(r.transacoes).toHaveLength(6);
  });

  it("extrato da B3 importa sem rejeicao", () => {
    const r = importarExtratoB3(modelo("extrato-b3.csv"));
    expect(r.rejeicoes).toEqual([]);
    expect(r.transacoes.map((t) => t.ticker)).toEqual(["PETR4", "ITUB4", "PETR4"]);
  });

  it("posicoes importam sem rejeicao nem pendencia", () => {
    const r = importarPosicaoBolsiq(modelo("posicoes-bolsiq.csv"));
    expect(r.rejeicoes).toEqual([]);
    expect(r.pendencias).toEqual([]);
    expect(r.posicoes).toHaveLength(6);
  });
});
