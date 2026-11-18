import { describe, expect, it } from "vitest";
import { fimDoSilencio } from "./silencio.js";

const SP = "America/Sao_Paulo";

describe("fimDoSilencio", () => {
  it("sem janela configurada nao silencia", () => {
    expect(fimDoSilencio(new Date(), null, "07:00", SP)).toBeNull();
    expect(fimDoSilencio(new Date(), "22:00", null, SP)).toBeNull();
  });

  it("janela que cruza a meia-noite, dentro dela", () => {
    // 01:00Z = 22:00 em Sao Paulo
    const fim = fimDoSilencio(new Date("2026-11-02T01:30:00Z"), "22:00", "07:00", SP);
    expect(fim?.toISOString()).toBe("2026-11-02T10:00:00.000Z");
  });

  it("janela que cruza a meia-noite, depois da meia-noite", () => {
    // 06:00Z = 03:00 em Sao Paulo
    const fim = fimDoSilencio(new Date("2026-11-02T06:00:00Z"), "22:00", "07:00", SP);
    expect(fim?.toISOString()).toBe("2026-11-02T10:00:00.000Z");
  });

  it("fora da janela nao silencia", () => {
    // 15:00Z = 12:00 em Sao Paulo
    expect(
      fimDoSilencio(new Date("2026-11-02T15:00:00Z"), "22:00", "07:00", SP),
    ).toBeNull();
  });

  it("janela no mesmo dia", () => {
    const fim = fimDoSilencio(new Date("2026-11-02T16:00:00Z"), "12:00", "14:00", SP);
    expect(fim?.toISOString()).toBe("2026-11-02T17:00:00.000Z");
  });

  it("horario invalido ou inicio igual ao fim desliga", () => {
    expect(fimDoSilencio(new Date(), "25:00", "07:00", SP)).toBeNull();
    expect(fimDoSilencio(new Date(), "22:00", "22:00", SP)).toBeNull();
  });
});
