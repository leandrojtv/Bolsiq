import { describe, expect, it } from "vitest";
import { janelasDeConsulta, parseBcbDate, SERIES_SGS } from "./bcb.js";

describe("parseBcbDate", () => {
  it("interpreta dd/MM/yyyy", () => {
    expect(parseBcbDate("30/10/2026")).toBe("2026-10-30");
    expect(parseBcbDate("01/09/2026")).toBe("2026-09-01");
  });

  it("não troca dia por mês nos doze primeiros dias", () => {
    // new Date("01/02/2026") daria 1º de fevereiro; o correto é 2 de janeiro.
    expect(parseBcbDate("02/01/2026")).toBe("2026-01-02");
    expect(parseBcbDate("12/03/2026")).toBe("2026-03-12");
  });

  it("recusa formato e valores inválidos", () => {
    expect(() => parseBcbDate("2026-10-30")).toThrow();
    expect(() => parseBcbDate("30/13/2026")).toThrow();
    expect(() => parseBcbDate("00/10/2026")).toThrow();
    expect(() => parseBcbDate("")).toThrow();
  });
});

describe("SERIES_SGS", () => {
  it("usa CDI diário como benchmark, não a Selic meta", () => {
    // 432 é a meta definida pelo Copom, não o que rendeu.
    expect(SERIES_SGS.cdiDiario.code).toBe("12");
    expect(SERIES_SGS.selicDiaria.code).toBe("11");
    expect(SERIES_SGS.selicMeta.code).toBe("432");
    expect(SERIES_SGS.ipcaMensal.frequency).toBe("monthly");
  });
});

describe("janelasDeConsulta", () => {
  it("devolve uma janela quando o intervalo é curto", () => {
    expect(janelasDeConsulta("2024-01-01", "2024-06-30")).toEqual([
      { from: "2024-01-01", to: "2024-06-30" },
    ]);
  });

  it("fatia intervalo longo, porque o SGS devolve 406", () => {
    const janelas = janelasDeConsulta("2010-01-01", "2026-01-01");
    expect(janelas.length).toBeGreaterThan(1);
    expect(janelas[0]?.from).toBe("2010-01-01");
    expect(janelas.at(-1)?.to).toBe("2026-01-01");
  });

  it("gera janelas contíguas e sem sobreposição", () => {
    const janelas = janelasDeConsulta("2010-01-01", "2020-12-31");
    for (let i = 1; i < janelas.length; i++) {
      const anterior = new Date(`${janelas[i - 1]?.to ?? ""}T00:00:00Z`);
      const atual = new Date(`${janelas[i]?.from ?? ""}T00:00:00Z`);
      expect(atual.getTime() - anterior.getTime()).toBe(86_400_000);
    }
  });

  it("respeita o tamanho de janela pedido", () => {
    const janelas = janelasDeConsulta("2020-01-01", "2024-12-31", 1);
    expect(janelas).toHaveLength(5);
  });

  it("recusa intervalo inválido", () => {
    expect(() => janelasDeConsulta("2024-12-31", "2024-01-01")).toThrow(/posterior/);
    expect(() => janelasDeConsulta("nao-e-data", "2024-01-01")).toThrow(/inválido/);
  });
});
