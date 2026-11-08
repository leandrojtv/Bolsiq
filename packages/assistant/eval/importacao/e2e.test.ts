import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extrairTexto } from "../../src/importacao/texto.js";
import { arquivosDoE2e, CAMINHO_DA_RESPOSTA, CAMINHO_DO_XLSX } from "./e2e.js";

const raiz = resolve(import.meta.dirname, "../../../..");

describe("arquivos do e2e", () => {
  it("estao em dia com as fixtures (rode o e2e:importacao do assistant)", async () => {
    const { xlsx, respostas } = arquivosDoE2e();
    expect(JSON.parse(readFileSync(resolve(raiz, CAMINHO_DA_RESPOSTA), "utf8"))).toEqual(
      respostas,
    );
    const versionado = new Uint8Array(readFileSync(resolve(raiz, CAMINHO_DO_XLSX)));
    expect((await extrairTexto(versionado, "xlsx")).partes).toEqual(
      (await extrairTexto(xlsx, "xlsx")).partes,
    );
  });
});
