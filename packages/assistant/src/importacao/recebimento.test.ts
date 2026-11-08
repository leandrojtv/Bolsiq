import { describe, expect, it } from "vitest";
import {
  conferirTamanho,
  ErroDeImportacao,
  hashDoConteudo,
  LIMITE_DE_BYTES,
  tipoDoArquivo,
} from "./recebimento.js";

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0]);
const PDF = bytes(0x25, 0x50, 0x44, 0x46);
const ZIP = bytes(0x50, 0x4b, 3, 4);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47);
const JPG = bytes(0xff, 0xd8, 0xff);
const texto = new TextEncoder().encode("a;b\n1;2");

describe("tipo do arquivo", () => {
  it("aceita pela extensao e pelo MIME", () => {
    expect(tipoDoArquivo("x.pdf", "application/pdf", PDF)).toBe("pdf");
    expect(
      tipoDoArquivo(
        "x.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ZIP,
      ),
    ).toBe("xlsx");
    expect(tipoDoArquivo("x.csv", "text/csv", texto)).toBe("csv");
    expect(tipoDoArquivo("X.TXT", "text/plain; charset=utf-8", texto)).toBe("txt");
    expect(tipoDoArquivo("x.png", "image/png", PNG)).toBe("imagem");
    expect(tipoDoArquivo("x.jpeg", "", JPG)).toBe("imagem");
    expect(tipoDoArquivo("x.pdf", "application/octet-stream", PDF)).toBe("pdf");
  });

  it("recusa extensao fora da lista e MIME trocado", () => {
    expect(() => tipoDoArquivo("x.exe", "", PDF)).toThrow(/não aceito/);
    expect(() => tipoDoArquivo("x.pdf", "text/html", PDF)).toThrow(/não aceito/);
    expect(() => tipoDoArquivo("semextensao", "application/pdf", PDF)).toThrow(
      ErroDeImportacao,
    );
  });

  it("confere a assinatura: HTML com nome de PDF nao passa", () => {
    const html = new TextEncoder().encode("<html>oi</html>");
    expect(() => tipoDoArquivo("x.pdf", "application/pdf", html)).toThrow(
      /não corresponde/,
    );
    expect(() => tipoDoArquivo("x.xlsx", "", html)).toThrow(/não corresponde/);
    expect(() => tipoDoArquivo("x.xls", "", html)).toThrow(/não corresponde/);
    expect(() => tipoDoArquivo("x.png", "", html)).toThrow(/não corresponde/);
  });
});

describe("tamanho e hash", () => {
  it("recusa vazio e acima de 10 MB", () => {
    expect(() => conferirTamanho(0)).toThrow(/vazio/);
    expect(() => conferirTamanho(LIMITE_DE_BYTES + 1)).toThrow(/10 MB/);
    expect(() => conferirTamanho(LIMITE_DE_BYTES)).not.toThrow();
  });

  it("SHA-256 do conteudo", () => {
    expect(hashDoConteudo(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
