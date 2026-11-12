import { describe, expect, it } from "vitest";
import { SaidaDaIAParaOModelo, saidaVazia } from "./esquema.js";

const comUnion = (n: unknown): number => {
  if (!n || typeof n !== "object") return 0;
  const o = n as Record<string, unknown>;
  const aqui = Array.isArray(o.type) || "anyOf" in o || "oneOf" in o ? 1 : 0;
  return aqui + Object.values(o).reduce<number>((s, v) => s + comUnion(v), 0);
};

describe("schema enviado ao modelo", () => {
  it("nao tem union: a Anthropic recusa mais de 16", async () => {
    const s = await SaidaDaIAParaOModelo.jsonSchema;
    expect(comUnion(s)).toBe(0);
    expect(JSON.stringify(s)).not.toContain('"null"');
  });

  it('"" volta a ser null nos campos anulaveis, e null continua aceito', async () => {
    const v = saidaVazia();
    const r = await SaidaDaIAParaOModelo.validate!({
      ...v,
      documento: { ...v.documento, corretora: "", data_referencia: null },
      notas: [
        {
          numero: "1",
          data_pregao: "",
          corretora: "XP",
          taxas_total: "",
          irrf: "",
          valor_liquido: "",
          sentido_liquido: "",
          origem: { pagina_ou_aba: "texto", trecho_original: "" },
        },
      ],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.value.documento.corretora).toBeNull();
    expect(r.value.documento.data_referencia).toBeNull();
    expect(r.value.notas[0]).toMatchObject({
      corretora: "XP",
      sentido_liquido: null,
      data_pregao: null,
      origem: { trecho_original: "" },
    });
  });
});
