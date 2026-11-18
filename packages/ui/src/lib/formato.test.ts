import { describe, expect, it } from "vitest";
import {
  direcaoDe,
  formatarAtraso,
  formatarCompacto,
  formatarDinheiro,
  formatarHorario,
  formatarNumero,
  formatarPercentual,
} from "./formato.js";

describe("formatacao pt-BR", () => {
  it("numero e dinheiro com virgula decimal e ponto de milhar", () => {
    expect(formatarNumero("1234567.891")).toBe("1.234.567,89");
    expect(formatarDinheiro("37.42")).toBe("R$ 37,42");
    expect(formatarDinheiro(-52.8)).toBe("-R$ 52,80");
  });

  it("percentual a partir de fracao, com e sem sinal", () => {
    expect(formatarPercentual("0.0235")).toBe("2,35%");
    expect(formatarPercentual(0.0235, { sinal: true })).toBe("+2,35%");
    expect(formatarPercentual(-0.0082, { sinal: true })).toBe("-0,82%");
    expect(formatarPercentual(-0.0082)).toBe("-0,82%");
  });

  it("compacto em mil, mi e bi", () => {
    expect(formatarCompacto(48_200_000)).toBe("48,2 mi");
    expect(formatarCompacto("1234000000")).toBe("1,2 bi");
    expect(formatarCompacto(3_400)).toBe("3,4 mil");
  });

  it("direcao", () => {
    expect(direcaoDe("0.1")).toBe("alta");
    expect(direcaoDe(-1)).toBe("queda");
    expect(direcaoDe("0")).toBe("estavel");
  });

  it("horario em Sao Paulo, com data quando nao e hoje", () => {
    const agora = new Date("2026-11-02T18:00:00Z");
    expect(formatarHorario("2026-11-02T17:52:00Z", agora)).toBe("14:52");
    expect(formatarHorario("2026-10-30T09:15:00Z", agora)).toBe("30/10 06:15");
  });

  it("atraso em min, h e dias", () => {
    expect(formatarAtraso(15)).toBe("15 min");
    expect(formatarAtraso(60)).toBe("1 h");
    expect(formatarAtraso(90)).toBe("1 h 30 min");
    expect(formatarAtraso(1440)).toBe("1 dia");
    expect(formatarAtraso(4320)).toBe("3 dias");
  });
});
