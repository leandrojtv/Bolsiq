import { describe, expect, it } from "vitest";
import { CASOS } from "./casos.js";
import { executarCaso, resumir } from "./executar.js";
import {
  extrairNumeros,
  numeroPresente,
  numerosInventados,
  parametrosBatem,
  tickersNoTexto,
} from "./medir.js";
import { modeloDeRoteiro } from "./roteiro.js";

describe("eval com o roteiro", () => {
  it("tem de 20 a 30 perguntas", () => {
    expect(CASOS.length).toBeGreaterThanOrEqual(20);
    expect(CASOS.length).toBeLessThanOrEqual(30);
  });

  it("os valores esperados saem das ferramentas reais, sobre a base de teste", async () => {
    const resultados = [];
    for (const c of CASOS) resultados.push(await executarCaso(c, modeloDeRoteiro));
    const falhas = resultados
      .filter(
        (r) =>
          !(
            r.ferramenta_certa &&
            r.parametros_certos &&
            r.numeros_certos &&
            r.texto_certo
          ),
      )
      .map((r) => ({
        id: r.id,
        faltando: r.numeros_faltando,
        sem_origem: r.numeros_sem_origem,
        resposta: r.resposta,
        erro: r.erro,
      }));
    expect(falhas).toEqual([]);
    expect(resumir(resultados).aprovado).toBe(true);
  });
});

describe("medidas do eval", () => {
  it("le numero em pt-BR e com ponto", () => {
    expect(extrairNumeros("R$ 9.965,60 e 38.42").map((e) => e.valor)).toEqual([
      9965.6, 38.42,
    ]);
    expect(extrairNumeros("PETR4 em 31/10/2026").length).toBe(0);
    expect(extrairNumeros("[R$ 1,00](/ativo/PETR4)").map((e) => e.valor)).toEqual([1]);
  });

  it("aceita arredondamento nas casas escritas, nao outro valor", () => {
    expect(numeroPresente(69.3946, extrairNumeros("69,39%"))).toBe(true);
    expect(numeroPresente(69.3946, extrairNumeros("69,4%"))).toBe(true);
    expect(numeroPresente(69.3946, extrairNumeros("70,4%"))).toBe(false);
    expect(numeroPresente(38.42, extrairNumeros("38"))).toBe(false);
  });

  it("acusa numero sem origem nas ferramentas", () => {
    const saidas = [{ preco: "38.42", fracao: 0.693946, lucro: "37000000000" }];
    expect(numerosInventados("R$ 38,42 e 69,39%", saidas, "")).toEqual([]);
    expect(numerosInventados("37 bilhões", saidas, "")).toEqual([]);
    expect(numerosInventados("R$ 41,00", saidas, "")).toEqual([41]);
    expect(numerosInventados("3 ativos", saidas, "")).toEqual([]);
    expect(numerosInventados("R$ 1.000", saidas, "Onde aportar R$ 1.000?")).toEqual([]);
  });

  it("confere parametros e tickers", () => {
    expect(parametrosBatem({ tickers: ["A", "B"] }, { tickers: ["B", "A"], x: 1 })).toBe(
      true,
    );
    expect(parametrosBatem({ tickers: ["A"] }, { tickers: ["A", "B"] })).toBe(false);
    expect(parametrosBatem({ valor: 1000 }, { valor: 999 })).toBe(false);
    expect(tickersNoTexto("PETR4, HGLG11 e PETR4")).toEqual(["PETR4", "HGLG11"]);
  });
});
