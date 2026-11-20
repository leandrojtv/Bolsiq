import { describe, expect, it } from "vitest";
import { estadoDoOrcamento, mediaDosMeses } from "./orcamento.js";
import { fluxoProjetado } from "./fluxo.js";
import { dividirTotal, parcelasNoCartao, somarMeses } from "./parcelamento.js";

describe("parcelas no cartao", () => {
  const ciclo = { dia_fechamento: 28, dia_vencimento: 5 };
  it("10x de 120: uma em cada fatura, pelo ciclo, atravessando o ano", () => {
    const p = parcelasNoCartao(ciclo, "2024-11-20", Array(10).fill("120.00"));
    expect(p.map((x) => x.fatura.vencimento)).toEqual([
      "2024-12-05",
      "2025-01-05",
      "2025-02-05",
      "2025-03-05",
      "2025-04-05",
      "2025-05-05",
      "2025-06-05",
      "2025-07-05",
      "2025-08-05",
      "2025-09-05",
    ]);
    expect(p[0]?.data).toBe("2024-11-20");
    // Fevereiro: fecha em 28/02 (2025 nao e bissexto).
    expect(p[3]?.data).toBe("2025-02-28");
    expect(parcelasNoCartao(ciclo, "2024-11-20", Array(10).fill("1"), 4)[0]?.numero).toBe(
      4,
    );
  });
  it("divide o total com o residuo na primeira", () => {
    expect(dividirTotal("100", 3)).toEqual(["33.34", "33.33", "33.33"]);
    expect(dividirTotal("1200", 10)).toEqual(Array(10).fill("120.00"));
  });
  it("soma meses com o ultimo dia", () => {
    expect(somarMeses("2024-01-31", 1)).toBe("2024-02-29");
    expect(somarMeses("2024-12-15", 2)).toBe("2025-02-15");
  });
});

describe("fluxo projetado", () => {
  it("entradas, saidas, saldo e o primeiro mes negativo; atrasado entra no primeiro", () => {
    const f = fluxoProjetado(
      "1000",
      [
        { data: "2024-03-01", valor: "-50" },
        { data: "2024-03-20", valor: "3000" },
        { data: "2024-03-25", valor: "-1800" },
        { data: "2024-04-05", valor: "-2500" },
        { data: "2024-05-10", valor: "-400" },
        { data: "2024-09-01", valor: "-1" },
      ],
      "2024-03-15",
      3,
    );
    expect(f.meses).toEqual([
      { mes: "2024-03", entradas: "3000.00", saidas: "1850.00", saldo_final: "2150.00" },
      { mes: "2024-04", entradas: "0.00", saidas: "2500.00", saldo_final: "-350.00" },
      { mes: "2024-05", entradas: "0.00", saidas: "400.00", saldo_final: "-750.00" },
    ]);
    expect(f.primeiro_mes_negativo).toBe("2024-04");
    expect(fluxoProjetado("10", [], "2024-12-01", 2).meses.map((m) => m.mes)).toEqual([
      "2024-12",
      "2025-01",
    ]);
    expect(fluxoProjetado("10", [], "2024-12-01", 2).primeiro_mes_negativo).toBeNull();
  });
});

describe("orcamento", () => {
  it("ok, atencao a partir de 80% e estourado acima de 100%", () => {
    expect(estadoDoOrcamento("1000", "799.99")).toBe("ok");
    expect(estadoDoOrcamento("1000", "800")).toBe("atencao");
    expect(estadoDoOrcamento("1000", "1000")).toBe("atencao");
    expect(estadoDoOrcamento("1000", "1000.01")).toBe("estourado");
    expect(estadoDoOrcamento("0", "1")).toBe("estourado");
    expect(estadoDoOrcamento("0", "0")).toBe("ok");
  });
  it("media dos 3 meses", () => {
    expect(mediaDosMeses(["300", "450"])).toBe("250.00");
    expect(mediaDosMeses(["100", "100", "101"])).toBe("100.33");
  });
});
