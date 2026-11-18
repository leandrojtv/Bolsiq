import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ferramentasDoSistema, SenhaIncorreta } from "./ferramentas.js";

/**
 * Programas falsos no PATH, com os mesmos argumentos dos de verdade: confere o
 * adaptador (arquivos temporarios, argumentos, saida) sem depender do poppler,
 * do tesseract nem do qpdf na maquina do teste.
 */
const FALSOS: Record<string, string> = {
  pdftotext: `printf 'pagina um\\fpagina dois\\f'`,
  pdftoppm: `for a; do ultimo="$a"; done; printf 'png' > "$ultimo.png"`,
  tesseract: `echo "texto do ocr: $3 $4 $5 $6"`,
  "heif-convert": `printf 'png convertido' > "$2"`,
  qpdf: `senha=$(cat "\${1#--password-file=}")
case "$senha" in
  certa) cp "$3" "$4" ;;
  aviso) cp "$3" "$4"; exit 3 ;;
  *) echo "qpdf: invalid password" >&2; exit 2 ;;
esac`,
};

let pathAntes: string | undefined;
beforeAll(() => {
  const pasta = mkdtempSync(join(tmpdir(), "falsos-"));
  for (const [nome, corpo] of Object.entries(FALSOS)) {
    writeFileSync(join(pasta, nome), `#!/bin/sh\n${corpo}\n`);
    chmodSync(join(pasta, nome), 0o755);
  }
  pathAntes = process.env.PATH;
  process.env.PATH = `${pasta}:${pathAntes ?? ""}`;
});
afterAll(() => {
  process.env.PATH = pathAntes;
});

const bytes = (s: string) => new TextEncoder().encode(s);
const texto = (b: Uint8Array) => new TextDecoder().decode(b);

describe("programas do sistema", () => {
  it("acha os programas e usa cada um com os argumentos certos", async () => {
    const f = await ferramentasDoSistema();
    expect(Object.keys(f).sort()).toEqual([
      "decifrarPdf",
      "heicParaPng",
      "ocr",
      "pdftotext",
      "renderizar",
    ]);
    expect(await f.pdftotext?.(bytes("%PDF"))).toEqual(["pagina um", "pagina dois"]);
    expect(texto((await f.renderizar?.(bytes("%PDF"), 3)) ?? new Uint8Array())).toBe(
      "png",
    );
    expect(await f.ocr?.(bytes("png"))).toBe("texto do ocr: -l por --psm 6\n");
    expect(texto((await f.heicParaPng?.(bytes("heic"))) ?? new Uint8Array())).toBe(
      "png convertido",
    );
  });

  it("qpdf: senha certa decifra, aviso ainda vale, senha errada e SenhaIncorreta", async () => {
    const f = await ferramentasDoSistema();
    expect(
      texto((await f.decifrarPdf?.(bytes("conteudo"), "certa")) ?? new Uint8Array()),
    ).toBe("conteudo");
    expect(
      texto((await f.decifrarPdf?.(bytes("conteudo"), "aviso")) ?? new Uint8Array()),
    ).toBe("conteudo");
    await expect(f.decifrarPdf?.(bytes("conteudo"), "errada")).rejects.toBeInstanceOf(
      SenhaIncorreta,
    );
  });

  it("sem os programas, nada: a leitura escolhe outra estrategia", async () => {
    const antes = process.env.PATH;
    process.env.PATH = "/nao-existe";
    try {
      expect(await ferramentasDoSistema()).toEqual({});
    } finally {
      process.env.PATH = antes;
    }
  });
});
