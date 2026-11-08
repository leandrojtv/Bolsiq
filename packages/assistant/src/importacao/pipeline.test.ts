import { describe, expect, it } from "vitest";
import {
  armazemEmMemoria,
  CAPACIDADES_COMPLETAS,
  modeloDeRoteiro,
  verificadorDasFixtures,
} from "../../eval/importacao/executar.js";
import { FIXTURES, HOJE } from "../../eval/importacao/fixtures.js";
import {
  conferirCapacidades,
  detectarAtalho,
  estimarImportacao,
  prepararArquivo,
} from "./pipeline.js";
import { importarComIA } from "./servico.js";

const csv = (t: string) => ({
  nome: "a.csv",
  mime: "text/csv",
  bytes: new TextEncoder().encode(t),
});

describe("atalho deterministico", () => {
  it("reconhece os tres layouts que ja existem pelo cabecalho", () => {
    expect(detectarAtalho("data;ticker;tipo;quantidade;preco;taxas\n")).toBe("bolsiq");
    expect(detectarAtalho("\uFEFFdata_posicao,corretora,classe,ativo")).toBe(
      "posicao_bolsiq",
    );
    expect(
      detectarAtalho(
        "Entrada/Saída;Data;Movimentação;Produto;Código;Quantidade;Preço unitário",
      ),
    ).toBe("b3");
    expect(detectarAtalho("Data do Negócio;Código de Negociação;Qtd")).toBe("b3");
    expect(detectarAtalho("Valor Atual;Ativo;Qtd")).toBeNull();
  });

  it("arquivo reconhecido nao chama a IA", async () => {
    const p = await prepararArquivo(
      csv("data;ticker;tipo;quantidade;preco\n2026-01-02;PETR4;compra;1;30"),
    );
    expect(p).toMatchObject({ atalho: "bolsiq", lotes: [], partes: [] });
    const colado = await prepararArquivo({ texto: "data_posicao,corretora,classe\n" });
    expect(colado.atalho).toBe("posicao_bolsiq");
    await expect(
      importarComIA({
        arquivo: p,
        original: null,
        modelo: modeloDeRoteiro(FIXTURES[0]!.resposta),
        provedor: "x",
        nome_do_modelo: "x",
        preco: { entrada: null, saida: null },
        capacidades: CAPACIDADES_COMPLETAS,
        armazem: armazemEmMemoria().armazem,
        verificador: verificadorDasFixtures(),
        hoje: HOJE,
        limite_diario: 1,
        segredos: [],
      }),
    ).rejects.toMatchObject({ codigo: "atalho" });
  });

  it("texto colado vazio e arquivo sem nada sao recusados", async () => {
    await expect(prepararArquivo({ texto: "  " })).rejects.toThrow(/Cole o texto/);
  });
});

describe("estimativa e capacidades", () => {
  it("estima tokens e custo antes de chamar", async () => {
    const p = await prepararArquivo(FIXTURES[0]!.arquivo());
    const e = estimarImportacao(p, { entrada: 1, saida: 2 });
    expect(e.chamadas).toBe(1);
    expect(e.tokens_entrada).toBeGreaterThan(1000);
    expect(e.tokens_saida).toBeGreaterThan(0);
    expect(Number(e.custo_estimado)).toBeGreaterThan(0);
    expect(
      estimarImportacao(p, { entrada: null, saida: null }).custo_estimado,
    ).toBeNull();
    const scan = await prepararArquivo(FIXTURES.find((f) => f.esperado.visao)!.arquivo());
    expect(estimarImportacao(scan, { entrada: 1, saida: 1 }).chamadas).toBe(1);
  });

  it("modelo sem saida estruturada nao importa", async () => {
    const p = await prepararArquivo(FIXTURES[0]!.arquivo());
    expect(() =>
      conferirCapacidades(p, { ...CAPACIDADES_COMPLETAS, saida_estruturada: false }),
    ).toThrow(/saída estruturada/);
  });
});
