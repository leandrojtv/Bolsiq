import { describe, expect, it } from "vitest";
import {
  decimalDigitado,
  descreverCondicao,
  NovaRegra,
  paramsDaRegra,
  TIPOS,
} from "./alertas-modelo";

const base = {
  ticker: "petr4",
  canais: ["inapp"],
  cooldown_segundos: 86_400,
  silencio: "nenhum",
} as const;

describe("modelo de alerta", () => {
  it("os 9 tipos em 3 grupos", () => {
    expect(TIPOS).toHaveLength(9);
    expect(new Set(TIPOS.map((t) => t.grupo))).toEqual(
      new Set(["Preço", "Fundamentos", "Eventos"]),
    );
  });

  it("le numero digitado em pt-BR", () => {
    expect(decimalDigitado("R$ 1.234,50")).toBe("1234.50");
    expect(decimalDigitado("37,5")).toBe("37.5");
    expect(decimalDigitado("3%")).toBe("3");
    expect(decimalDigitado("abc")).toBeNull();
  });

  it("valor obrigatorio so quando o tipo exige", () => {
    expect(NovaRegra.safeParse({ ...base, tipo: "preco_acima" }).success).toBe(false);
    expect(NovaRegra.safeParse({ ...base, tipo: "abaixo_graham" }).success).toBe(true);
    expect(
      NovaRegra.safeParse({ ...base, tipo: "data_com_proxima", valor: "90" }).success,
    ).toBe(false);
    const r = NovaRegra.parse({ ...base, tipo: "preco_acima", valor: "37,00" });
    expect(r.ticker).toBe("PETR4");
    expect(paramsDaRegra(r)).toEqual({ valor: "37.00" });
  });

  it("percentual e dias viram o formato do motor", () => {
    expect(
      paramsDaRegra(NovaRegra.parse({ ...base, tipo: "dy_acima", valor: "6" })),
    ).toEqual({ percentual: 0.06 });
    expect(
      paramsDaRegra(NovaRegra.parse({ ...base, tipo: "data_com_proxima", valor: "5" })),
    ).toEqual({ dias: 5 });
    expect(
      paramsDaRegra(NovaRegra.parse({ ...base, tipo: "provento_anunciado" })),
    ).toEqual({});
  });

  it("descreve a condicao", () => {
    expect(descreverCondicao("preco_acima", { valor: "37.00" })).toBe(
      "Preço acima de R$ 37,00",
    );
    expect(descreverCondicao("variacao_diaria", { percentual: 0.03 })).toBe(
      "Variação diária maior que 3,0%",
    );
    expect(descreverCondicao("data_com_proxima", { dias: 5 })).toBe(
      "Data com nos próximos 5 dias",
    );
    expect(descreverCondicao("abaixo_graham", {})).toBe(
      "Abaixo do preço justo de Graham",
    );
  });
});
