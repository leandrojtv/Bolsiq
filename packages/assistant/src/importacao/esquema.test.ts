import { zodSchema } from "ai";
import { describe, expect, it } from "vitest";
import { SaidaDaIA } from "./esquema.js";

/** Campos com uniao de tipos: `type: [..]`, `anyOf` ou `oneOf`, em qualquer nivel. */
function unioes(no: unknown): number {
  if (Array.isArray(no)) return no.reduce((s: number, x) => s + unioes(x), 0);
  if (!no || typeof no !== "object") return 0;
  const o = no as Record<string, unknown>;
  const aqui = Array.isArray(o.type) || "anyOf" in o || "oneOf" in o ? 1 : 0;
  return aqui + Object.values(o).reduce((s: number, v) => s + unioes(v), 0);
}

describe("schema enviado ao provedor", () => {
  it("nao tem uniao de tipos: a Anthropic recusa acima de 16", async () => {
    const json = await zodSchema(SaidaDaIA).jsonSchema;
    expect(unioes(json)).toBe(0);
  });

  it("todo campo de objeto e obrigatorio, como exige a saida estrita da OpenAI", async () => {
    const json = (await zodSchema(SaidaDaIA).jsonSchema) as Record<string, unknown>;
    const conferir = (no: unknown): void => {
      if (!no || typeof no !== "object") return;
      const o = no as { properties?: Record<string, unknown>; required?: string[] };
      if (o.properties)
        expect([...(o.required ?? [])].sort()).toEqual(Object.keys(o.properties).sort());
      Object.values(no).forEach(conferir);
    };
    conferir(json);
  });
});
