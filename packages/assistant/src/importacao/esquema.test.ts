import { describe, expect, it } from "vitest";
import { lerSaida, SaidaDaIAParaOModelo, saidaVazia } from "./esquema.js";

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

describe("leitura da resposta sem strict", () => {
  const posicao = {
    classe: "acao",
    codigo: "CURY3",
    quantidade: 161,
    saldo_bruto: "4590.11",
    origem: { pagina_ou_aba: "texto", trecho_original: "CURY3;R$ 4.590,11" },
    confianca: "Média",
  };

  it("campo omitido vira null, numero vira texto, acento sai do enum", () => {
    const r = lerSaida({ documento: { tipo: "posicao" }, posicoes: [posicao] });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.posicoes[0]).toMatchObject({
      codigo: "CURY3",
      quantidade: "161",
      cnpj: null,
      confianca: "media",
    });
    expect(r.data.documento).toEqual({
      tipo: "posicao",
      corretora: null,
      data_referencia: null,
      totais_declarados: [],
    });
    expect(r.data.transacoes).toEqual([]);
  });

  it("lista como texto JSON e resposta embrulhada", () => {
    const r = lerSaida({
      extrato_bolsiq: {
        documento: { tipo: "outro" },
        posicoes: JSON.stringify([posicao]),
      },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.documento.tipo).toBe("misto");
    expect(r.data.posicoes).toHaveLength(1);
  });

  it("linha que nao serve sai com aviso; as outras ficam", () => {
    const r = lerSaida({
      documento: { tipo: "posicao" },
      posicoes: [posicao, { codigo: "ITUB4", confianca: "alta" }],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.posicoes.map((p) => p.codigo)).toEqual(["CURY3"]);
    expect(r.data.avisos[0]).toMatch(/^posicoes\[1\] descartada: origem/);
  });

  it("o erro diz o campo", async () => {
    const r = await SaidaDaIAParaOModelo.validate!({ documento: 1 });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.message).toMatch(/schema: documento/);
  });
});
