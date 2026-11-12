import { zodSchema } from "ai";
import { describe, expect, it } from "vitest";
import { CabecalhoDaIA } from "./esquema.js";

/** Campos com uniao de tipos: `type: [..]`, `anyOf` ou `oneOf`, em qualquer nivel. */
function unioes(no: unknown): number {
  if (Array.isArray(no)) return no.reduce((s: number, x) => s + unioes(x), 0);
  if (!no || typeof no !== "object") return 0;
  const o = no as Record<string, unknown>;
  const aqui = Array.isArray(o.type) || "anyOf" in o || "oneOf" in o ? 1 : 0;
  return aqui + Object.values(o).reduce((s: number, v) => s + unioes(v), 0);
}

/** Propriedades declaradas, em qualquer nivel. */
function propriedades(no: unknown): number {
  if (!no || typeof no !== "object") return 0;
  const o = no as { properties?: Record<string, unknown> };
  return (
    Object.keys(o.properties ?? {}).length +
    Object.values(no).reduce((s: number, v) => s + propriedades(v), 0)
  );
}

/**
 * O unico schema que vai ao provedor. A saida estrita compila o schema numa
 * gramatica: o schema das linhas (26 campos em quatro listas) passava do limite
 * ("The compiled grammar is too large"). Este teste falha se ele voltar.
 */
describe("schema enviado ao provedor", () => {
  it("o cabecalho tem no maximo 10 propriedades no total", async () => {
    expect(propriedades(await zodSchema(CabecalhoDaIA).jsonSchema)).toBeLessThanOrEqual(
      10,
    );
  });

  it("nao tem uniao de tipos: a Anthropic recusa acima de 16", async () => {
    expect(unioes(await zodSchema(CabecalhoDaIA).jsonSchema)).toBe(0);
  });

  it("todo campo de objeto e obrigatorio, como exige a saida estrita da OpenAI", async () => {
    const conferir = (no: unknown): void => {
      if (!no || typeof no !== "object") return;
      const o = no as { properties?: Record<string, unknown>; required?: string[] };
      if (o.properties)
        expect([...(o.required ?? [])].sort()).toEqual(Object.keys(o.properties).sort());
      Object.values(no).forEach(conferir);
    };
    conferir(await zodSchema(CabecalhoDaIA).jsonSchema);
  });
});
