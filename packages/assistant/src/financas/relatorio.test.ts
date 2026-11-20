import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { fontesFinanceirasDeTeste } from "../../eval/base-financas.js";
import {
  custoDoRelatorio,
  dadosDoRelatorio,
  escreverRelatorio,
  nomeDoMes,
  textoPadrao,
} from "./relatorio.js";

const USO = {
  inputTokens: { total: 3000, noCache: 3000, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 400, text: 400, reasoning: 0 },
};

const modelo = (texto: string | Error) =>
  new MockLanguageModelV4({
    doGenerate: () =>
      texto instanceof Error
        ? Promise.reject(texto)
        : Promise.resolve({
            content: [{ type: "text", text: texto }],
            finishReason: { unified: "stop", raw: undefined },
            usage: USO,
            warnings: [],
          }),
  });

describe("relatorio mensal", () => {
  it("dados do mes: totais, maiores gastos e 3 cortes com a economia", async () => {
    const r = await dadosDoRelatorio(fontesFinanceirasDeTeste(), "2026-10");
    expect(r).toMatchObject({
      mes: "2026-10",
      renda_recebida: "8000.00",
      despesas: "5161.20",
      maiores_gastos: [
        { categoria: "Moradia", valor: "2500.00" },
        { categoria: "Mercado", valor: "1100.00" },
        { categoria: "Compras", valor: "350.00" },
      ],
      cortes: [
        { acao: "reduzir pela metade", economia_mensal: "73.20" },
        { acao: "cancelar", economia_mensal: "44.90" },
        { economia_mensal: "39.90" },
      ],
      economia_mensal: "158.00",
      economia_anual: "1896.00",
      sem_movimento: false,
    });
  });

  it("texto padrao com os mesmos numeros", async () => {
    const r = await dadosDoRelatorio(fontesFinanceirasDeTeste(), "2026-10");
    const t = textoPadrao(r);
    expect(t).toContain(
      "Em outubro de 2026 você recebeu R$ 8.000,00 e gastou R$ 5.161,20",
    );
    expect(t).toContain("Economia estimada: R$ 158,00 por mês, R$ 1.896,00 por ano.");
    expect(textoPadrao({ ...r, maiores_gastos: [], cortes: [] })).toContain(
      "Nenhum corte recorrente",
    );
  });

  it("aceita o texto do modelo so sem numero inventado", async () => {
    const dados = await dadosDoRelatorio(fontesFinanceirasDeTeste(), "2026-10");
    const ok = await escreverRelatorio({
      modelo: modelo(
        "Em outubro de 2026 entraram R$ 8.000,00 e saíram R$ 5.161,20. Cortando o efeito formiga pela metade, a Netflix e a tarifa, você economiza R$ 158,00 por mês (R$ 1.896,00 por ano).",
      ),
      dados,
      segredos: [],
    });
    expect(ok).toMatchObject({
      origem: "modelo",
      uso: { tokens_entrada: 3000, tokens_saida: 400 },
    });

    const inventou = await escreverRelatorio({
      modelo: modelo("Você economiza R$ 999,00 por mês."),
      dados,
      segredos: [],
    });
    expect(inventou.origem).toBe("padrao");
    expect(inventou.motivo).toContain("999");
    expect(inventou.texto).toBe(textoPadrao(dados));

    const vazio = await escreverRelatorio({ modelo: modelo("  "), dados, segredos: [] });
    expect(vazio).toMatchObject({ origem: "padrao", motivo: "vazio" });
  });

  it("erro do provedor vira texto padrao, sem a chave no motivo", async () => {
    const dados = await dadosDoRelatorio(fontesFinanceirasDeTeste(), "2026-10");
    const r = await escreverRelatorio({
      modelo: modelo(new Error("chave sk-segredo-123456 recusada")),
      dados,
      segredos: ["sk-segredo-123456"],
    });
    expect(r.origem).toBe("padrao");
    expect(r.motivo).not.toContain("sk-segredo-123456");
    expect(r.uso).toEqual({ tokens_entrada: 0, tokens_saida: 0 });
  });

  it("estimativa de custo e nome do mes", () => {
    expect(custoDoRelatorio({ entrada: 3, saida: 15 })).toBe("0.019500");
    expect(custoDoRelatorio({ entrada: null, saida: 15 })).toBeNull();
    expect(nomeDoMes("2026-03")).toBe("março de 2026");
  });
});
