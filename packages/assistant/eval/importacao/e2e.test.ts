import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extrairTexto } from "../../src/importacao/texto.js";
import { arquivosDoE2e, CAMINHO_DA_RESPOSTA } from "./e2e.js";

const raiz = resolve(import.meta.dirname, "../../../..");
const leitura = { visao: false, ferramentas: {}, limite_de_paginas: 500 };

describe("arquivos do e2e", () => {
  it("estao em dia com as fixtures (rode o e2e:importacao do assistant)", async () => {
    const { arquivos, respostas } = arquivosDoE2e();
    expect(JSON.parse(readFileSync(resolve(raiz, CAMINHO_DA_RESPOSTA), "utf8"))).toEqual(
      respostas,
    );
    for (const a of arquivos) {
      const tipo = a.caminho.endsWith(".pdf") ? "pdf" : "xlsx";
      const versionado = new Uint8Array(readFileSync(resolve(raiz, a.caminho)));
      expect((await extrairTexto(versionado, tipo, leitura)).partes).toEqual(
        (await extrairTexto(a.bytes, tipo, leitura)).partes,
      );
    }
  });
});
