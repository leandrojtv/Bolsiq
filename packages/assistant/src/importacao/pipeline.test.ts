import { describe, expect, it } from "vitest";
import {
  armazemEmMemoria,
  CAPACIDADES_COMPLETAS,
  modeloDeRoteiro,
  verificadorDasFixtures,
} from "../../eval/importacao/executar.js";
import { FIXTURES, HOJE } from "../../eval/importacao/fixtures.js";
import { detectarAtalho, estimarImportacao, prepararArquivo } from "./pipeline.js";
import { importarComIA } from "./servico.js";

/** Preparo com modelo de visao e sem programas do sistema. */
const PREPARO = {
  limites: { contexto: 200_000, max_saida: 16_000 },
  visao: true,
  ferramentas: {},
};

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
      PREPARO,
    );
    expect(p).toMatchObject({ atalho: "bolsiq", lotes: [], partes: [] });
    const colado = await prepararArquivo(
      { texto: "data_posicao,corretora,classe\n" },
      PREPARO,
    );
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
    await expect(prepararArquivo({ texto: "  " }, PREPARO)).rejects.toThrow(
      /Cole o texto/,
    );
  });
});

describe("estimativa e capacidades", () => {
  it("estima tokens e custo antes de chamar", async () => {
    const p = await prepararArquivo(FIXTURES[0]!.arquivo(), PREPARO);
    const e = estimarImportacao(p, { entrada: 1, saida: 2 });
    // Cabecalho e um lote.
    expect(e.chamadas).toBe(2);
    expect(e.tokens_entrada).toBeGreaterThan(1000);
    expect(e.tokens_saida).toBeGreaterThan(0);
    expect(Number(e.custo_estimado)).toBeGreaterThan(0);
    expect(
      estimarImportacao(p, { entrada: null, saida: null }).custo_estimado,
    ).toBeNull();
    const scan = await prepararArquivo(
      FIXTURES.find((f) => f.esperado.visao)!.arquivo(),
      PREPARO,
    );
    // Cabecalho e a chamada de visao.
    expect(estimarImportacao(scan, { entrada: 1, saida: 1 }).chamadas).toBe(2);
  });

  it("sem visao, a pagina escaneada vai por OCR; sem OCR, erro claro", async () => {
    const escaneada = FIXTURES.find((f) => f.esperado.visao)!.arquivo();
    const semVisao = { ...PREPARO, visao: false };
    await expect(prepararArquivo(escaneada, semVisao)).rejects.toMatchObject({
      codigo: "sem_ocr",
    });
    const ocr = await prepararArquivo(escaneada, {
      ...semVisao,
      ferramentas: {
        renderizar: () => Promise.resolve(new Uint8Array([1])),
        ocr: () =>
          Promise.resolve(
            "Nota de corretagem com texto lido pelo OCR, CPF 123.456.789-09",
          ),
      },
    });
    expect(ocr).toMatchObject({ estrategia: "ocr", ocr: ["página 1"], imagens: [] });
    // O texto do OCR passa pela anonimizacao como qualquer texto.
    expect(ocr.partes[0]?.texto).not.toContain("123.456.789-09");
    expect(ocr.lotes).toHaveLength(1);
  });

  it("nada bloqueia por tamanho de documento: 120 paginas viram varios lotes", async () => {
    const { pdfDeTexto } = await import("../../eval/importacao/pdf.js");
    const paginas = Array.from({ length: 120 }, (_, i) =>
      Array.from({ length: 30 }, (_, j) => `Página ${i + 1} linha ${j} PETR4 100 37,50`),
    );
    const p = await prepararArquivo(
      { nome: "longo.pdf", mime: "application/pdf", bytes: pdfDeTexto(paginas) },
      { ...PREPARO, limites: { contexto: 32_000, max_saida: 4_000 } },
    );
    expect(p.paginas).toBe(120);
    expect(p.lotes.length).toBeGreaterThan(5);
  });
});
