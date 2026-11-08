import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { pdfDeTexto, pdfEscaneado } from "../../eval/importacao/pdf.js";
import { decodificar, extrairTexto, textoColado } from "./texto.js";

describe("CSV e TXT", () => {
  it("texto direto, com o separador detectado no cabecalho", async () => {
    const t = await extrairTexto(
      new TextEncoder().encode("Ativo;Saldo\nPETR4;1.234,56"),
      "csv",
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
    const t = await extrairTexto(bytes, "xlsx");
    expect(t.paginas).toBe(3);
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
    await expect(extrairTexto(bytes, "xlsx")).rejects.toThrow(/limite é 30/);
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
    );
    expect(t.paginas).toBe(2);
    expect(t.sem_texto).toEqual([]);
    expect(t.partes.map((p) => p.origem)).toEqual(["página 1", "página 2"]);
    expect(t.partes[0]?.texto).toBe("Extrato de posição\nPETR4 | 100 | 3.842,00");
  });

  it("pagina escaneada fica marcada para visao, com o PDF anexo", async () => {
    const bytes = pdfEscaneado();
    const t = await extrairTexto(bytes, "pdf");
    expect(t.partes).toEqual([]);
    expect(t.sem_texto).toEqual(["página 1"]);
    expect(t.arquivo_para_visao?.mime).toBe("application/pdf");
  });

  it("recusa PDF acima de 30 paginas", async () => {
    const paginas = Array.from({ length: 31 }, (_, i) => [
      `Página ${i} com texto de sobra`,
    ]);
    await expect(extrairTexto(pdfDeTexto(paginas), "pdf")).rejects.toThrow(/31 páginas/);
  });
});

describe("imagem", () => {
  it("so marca para visao", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);
    const t = await extrairTexto(png, "imagem");
    expect(t.sem_texto).toEqual(["imagem"]);
    expect(t.arquivo_para_visao?.mime).toBe("image/png");
    const jpg = await extrairTexto(new Uint8Array([0xff, 0xd8, 0xff]), "imagem");
    expect(jpg.arquivo_para_visao?.mime).toBe("image/jpeg");
  });
});
