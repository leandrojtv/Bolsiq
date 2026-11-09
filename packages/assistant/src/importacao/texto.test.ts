import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { pdfDeTexto, pdfEscaneado } from "../../eval/importacao/pdf.js";
import {
  decodificar,
  ehHeic,
  exigeSenha,
  extrairTexto,
  linhaDoCabecalho,
  tabelasDaPlanilha,
  textoColado,
} from "./texto.js";
import type { FerramentasDoSistema } from "./ferramentas.js";

/** Leitura sem visao e sem programas do sistema. */
const L = { visao: false, ferramentas: {}, limite_de_paginas: 30 };

describe("CSV e TXT", () => {
  it("texto direto, com o separador detectado no cabecalho", async () => {
    const t = await extrairTexto(
      new TextEncoder().encode("Ativo;Saldo\nPETR4;1.234,56"),
      "csv",
      L,
    );
    expect(t.partes).toEqual([
      { origem: "texto", texto: "[separador ;]\nAtivo;Saldo\nPETR4;1.234,56" },
    ]);
    expect(t.arquivo_para_visao).toBeNull();
  });

  it("Windows-1252 de banco antigo vira texto certo", () => {
    expect(decodificar(new Uint8Array([0x50, 0x6f, 0x73, 0x69, 0xe7, 0xe3, 0x6f]))).toBe(
      "Posição",
    );
  });

  it("texto colado sem tabela vai inteiro", () => {
    expect(textoColado("Extrato de COE\nlinha").partes[0]?.texto).toBe(
      "Extrato de COE\nlinha",
    );
  });
});

describe("planilha", () => {
  it("cada aba vira uma tabela com o nome da aba e numero cru", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Ativo", "Saldo"],
        ["PETR4", 1234.5],
      ]),
      "Ações",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["Fundo"], [], ["XP MACRO"]]),
      "Fundos",
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "Vazia");
    const bytes = new Uint8Array(
      XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer,
    );
    const t = await extrairTexto(bytes, "xlsx", L);
    // Aba vazia nao conta.
    expect(t.paginas).toBe(2);
    expect(t.partes).toEqual([
      { origem: "aba Ações", texto: "[separador ;]\nAtivo;Saldo\nPETR4;1234.5" },
      { origem: "aba Fundos", texto: "[separador ;]\nFundo\nXP MACRO" },
    ]);
  });

  it("recusa planilha com abas demais", async () => {
    const wb = XLSX.utils.book_new();
    for (let i = 0; i < 31; i++)
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), `A${i}`);
    const bytes = new Uint8Array(
      XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer,
    );
    await expect(extrairTexto(bytes, "xlsx", L)).rejects.toThrow(/limite é 30/);
  });
});

describe("PDF", () => {
  it("texto por pagina, colunas separadas", async () => {
    const t = await extrairTexto(
      pdfDeTexto([
        ["Extrato de posição", ["PETR4", "100", "3.842,00"]],
        ["Página dois com texto suficiente"],
      ]),
      "pdf",
      L,
    );
    expect(t.paginas).toBe(2);
    expect(t.sem_texto).toEqual([]);
    expect(t.partes.map((p) => p.origem)).toEqual(["página 1", "página 2"]);
    expect(t.partes[0]?.texto).toBe("Extrato de posição\nPETR4 | 100 | 3.842,00");
  });

  it("pagina escaneada sem OCR nem visao e um erro claro", async () => {
    await expect(extrairTexto(pdfEscaneado(), "pdf", L)).rejects.toThrow(/não tem OCR/);
  });

  it("recusa PDF acima de 30 paginas", async () => {
    const paginas = Array.from({ length: 31 }, (_, i) => [
      `Página ${i} com texto de sobra`,
    ]);
    await expect(extrairTexto(pdfDeTexto(paginas), "pdf", L)).rejects.toThrow(
      /31 páginas/,
    );
  });
});

describe("imagem", () => {
  it("com visao vai como imagem; sem visao, por OCR", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);
    const v = await extrairTexto(png, "imagem", { ...L, visao: true });
    expect(v).toMatchObject({ sem_texto: ["imagem"], estrategia: "visao" });
    expect(v.imagens[0]?.mime).toBe("image/png");
    const jpg = await extrairTexto(new Uint8Array([0xff, 0xd8, 0xff]), "imagem", {
      ...L,
      visao: true,
    });
    expect(jpg.imagens[0]?.mime).toBe("image/jpeg");
    const ocr = await extrairTexto(png, "imagem", { ...L, ferramentas: FALSAS });
    expect(ocr).toMatchObject({
      estrategia: "ocr",
      ocr: ["imagem"],
      partes: [{ origem: "imagem", texto: "texto lido" }],
    });
    await expect(extrairTexto(png, "imagem", L)).rejects.toThrow(/OCR/);
  });

  it("HEIC do celular vira PNG antes", async () => {
    const heic = new Uint8Array([
      0,
      0,
      0,
      24,
      ...new TextEncoder().encode("ftypheic"),
      0,
      0,
    ]);
    expect(ehHeic(heic)).toBe(true);
    const t = await extrairTexto(heic, "imagem", {
      ...L,
      visao: true,
      ferramentas: FALSAS,
    });
    expect(t.imagens[0]?.mime).toBe("image/png");
    await expect(extrairTexto(heic, "imagem", { ...L, visao: true })).rejects.toThrow(
      /HEIC/,
    );
  });
});

const FALSAS: FerramentasDoSistema = {
  renderizar: (_p, n) => Promise.resolve(new TextEncoder().encode(`pag${n}`)),
  ocr: () => Promise.resolve("texto lido"),
  heicParaPng: () => Promise.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
  pdftotext: () =>
    Promise.resolve(["Página um do pdftotext com texto suficiente", "Página dois"]),
};

describe("PDF escaneado, com senha e quebrado", () => {
  it("escaneada com visao vai como imagem da pagina; sem visao, OCR", async () => {
    const v = await extrairTexto(pdfEscaneado(), "pdf", {
      ...L,
      visao: true,
      ferramentas: FALSAS,
    });
    expect(v).toMatchObject({ estrategia: "visao", sem_texto: ["página 1"], partes: [] });
    expect(new TextDecoder().decode(v.imagens[0]?.dados)).toBe("pag1");
    const o = await extrairTexto(pdfEscaneado(), "pdf", { ...L, ferramentas: FALSAS });
    expect(o).toMatchObject({
      estrategia: "ocr",
      ocr: ["página 1"],
      partes: [{ origem: "página 1", texto: "texto lido" }],
    });
  });

  it("escaneada com visao e sem renderizador manda o PDF inteiro", async () => {
    const v = await extrairTexto(pdfEscaneado(), "pdf", { ...L, visao: true });
    expect(v.arquivo_para_visao?.mime).toBe("application/pdf");
  });

  it("PDF com senha pede a senha, com dica", async () => {
    const cifrado = pdfDeTexto([["Extrato com senha e texto bastante"]], "12345");
    expect(await exigeSenha(cifrado)).toBe(true);
    expect(await exigeSenha(pdfDeTexto([["Sem senha"]]))).toBe(false);
    await expect(extrairTexto(cifrado, "pdf", L)).rejects.toMatchObject({
      codigo: "precisa_senha",
    });
  });

  it("PDF que o pdf.js nao abre vai pelo pdftotext", async () => {
    const quebrado = new TextEncoder().encode("%PDF-1.4\nlixo sem estrutura");
    const t = await extrairTexto(quebrado, "pdf", { ...L, ferramentas: FALSAS });
    // A segunda pagina do pdftotext tem pouco texto: vai para o OCR.
    expect(t.partes.map((p) => p.origem)).toEqual(["página 1", "página 2"]);
    expect(t.ocr).toEqual(["página 2"]);
    await expect(extrairTexto(quebrado, "pdf", L)).rejects.toThrow(
      /Não foi possível ler/,
    );
  });
});

describe("planilha fora do layout", () => {
  it("acha o cabecalho fora da linha 1", () => {
    expect(
      linhaDoCabecalho([
        ["Extrato"],
        ["Data: 31/10/2026", ""],
        ["Ativo", "Saldo"],
        ["PETR4", "10"],
      ]),
    ).toBe(2);
    expect(
      linhaDoCabecalho([
        ["1", "2"],
        ["3", "4"],
      ]),
    ).toBe(0);
  });

  it("expande mescla, tira linha e coluna vazias e guarda o que vem antes do cabecalho", () => {
    const aba = XLSX.utils.aoa_to_sheet([
      ["Banco X - Extrato"],
      [],
      ["Ativo", "", "Emissor", "Saldo"],
      ["CDB A", "", "Banco A", "R$ 1.000,00"],
      ["CDB B", "", "", "R$ 2.000,00"],
    ]);
    aba["!merges"] = [{ s: { r: 3, c: 2 }, e: { r: 4, c: 2 } }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, aba, "RF");
    const [t] = tabelasDaPlanilha(
      new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer),
    );
    expect(t).toEqual({
      origem: "aba RF",
      preambulo: "Banco X - Extrato",
      csv: "Ativo;Emissor;Saldo\nCDB A;Banco A;R$ 1.000,00\nCDB B;Banco A;R$ 2.000,00",
    });
  });

  it("aba no layout do Bolsiq vai sem IA; as outras vao para a IA; ODS tambem", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["data", "ticker", "tipo", "quantidade", "preco"],
        ["2026-10-01", "PETR4", "compra", 1, 30],
      ]),
      "Lancamentos",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Ativo", "Saldo"],
        ["CDB", 10],
      ]),
      "RF",
    );
    for (const bookType of ["xlsx", "ods"] as const) {
      const t = await extrairTexto(
        new Uint8Array(XLSX.write(wb, { type: "array", bookType }) as ArrayBuffer),
        bookType,
        L,
      );
      expect(t.no_layout).toEqual([
        {
          origem: "aba Lancamentos",
          atalho: "bolsiq",
          conteudo: "data;ticker;tipo;quantidade;preco\n2026-10-01;PETR4;compra;1;30",
        },
      ]);
      expect(t.partes.map((p) => p.origem)).toEqual(["aba RF"]);
    }
  });
});

describe("encoding", () => {
  it("latin1 e Windows-1252 com acento viram texto certo", () => {
    expect(decodificar(new Uint8Array(Buffer.from("Preço Médio;Saldo", "latin1")))).toBe(
      "Preço Médio;Saldo",
    );
    expect(decodificar(new TextEncoder().encode("\uFEFFAção"))).toBe("Ação");
  });
});
