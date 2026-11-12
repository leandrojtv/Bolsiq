import { describe, expect, it } from "vitest";
import {
  conferirTamanho,
  ErroDeImportacao,
  hashDoConteudo,
  LIMITES_PADRAO,
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
  it("recusa vazio e acima do limite, que e configuravel (50 MB por padrao)", () => {
    expect(() => conferirTamanho(0)).toThrow(/vazio/);
    expect(() => conferirTamanho(LIMITES_PADRAO.bytes + 1)).toThrow(/50 MB/);
    expect(() => conferirTamanho(LIMITES_PADRAO.bytes)).not.toThrow();
    expect(() => conferirTamanho(2 * 1024 * 1024, 1024 * 1024)).toThrow(/1 MB/);
  });

  it("aceita ODS e HEIC", () => {
    expect(
      tipoDoArquivo("x.ods", "application/vnd.oasis.opendocument.spreadsheet", ZIP),
    ).toBe("ods");
    const heic = new Uint8Array([
      0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ]);
    expect(tipoDoArquivo("foto.HEIC", "image/heic", heic)).toBe("imagem");
  });

  it("SHA-256 do conteudo", () => {
    expect(hashDoConteudo(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
