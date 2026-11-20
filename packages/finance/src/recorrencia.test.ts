import { describe, expect, it } from "vitest";
import {
  ocorrencias,
  somarDias,
  vezesNoMes,
  type RegraDeRecorrencia,
} from "./recorrencia.js";

const regra = (r: Partial<RegraDeRecorrencia>): RegraDeRecorrencia => ({
  frequencia: "mensal",
  dia: 5,
  inicio: "2024-01-01",
  fim: null,
  ...r,
});

describe("ocorrencias", () => {
  it("mensal no dia, com 31 virando o ultimo dia (fevereiro bissexto e nao)", () => {
    expect(ocorrencias(regra({ dia: 31 }), "2024-01-01", "2024-04-30")).toEqual([
      "2024-01-31",
      "2024-02-29",
      "2024-03-31",
      "2024-04-30",
    ]);
    expect(
      ocorrencias(regra({ dia: 30, inicio: "2023-01-01" }), "2023-02-01", "2023-02-28"),
    ).toEqual(["2023-02-28"]);
  });

  it("respeita inicio, fim e a virada de ano", () => {
    const r = regra({ dia: 10, inicio: "2023-11-15", fim: "2024-02-09" });
    expect(ocorrencias(r, "2023-01-01", "2025-01-01")).toEqual([
      "2023-12-10",
      "2024-01-10",
    ]);
    expect(ocorrencias(r, "2025-01-01", "2025-12-31")).toEqual([]);
  });

  it("semanal pelo dia da semana (1 = segunda, 7 = domingo)", () => {
    // 2024-01-01 foi segunda.
    expect(
      ocorrencias(regra({ frequencia: "semanal", dia: 1 }), "2024-01-01", "2024-01-22"),
    ).toEqual(["2024-01-01", "2024-01-08", "2024-01-15", "2024-01-22"]);
    expect(
      ocorrencias(regra({ frequencia: "semanal", dia: 7 }), "2024-01-01", "2024-01-14"),
    ).toEqual(["2024-01-07", "2024-01-14"]);
    expect(
      ocorrencias(regra({ frequencia: "semanal", dia: 3 }), "2023-12-29", "2024-01-05"),
    ).toEqual(["2024-01-03"]);
  });

  it("anual no mes do inicio; 29/02 vira 28/02 em ano comum", () => {
    const r = regra({ frequencia: "anual", dia: 29, inicio: "2024-02-29" });
    expect(ocorrencias(r, "2024-01-01", "2026-12-31")).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
    ]);
  });

  it("vezes no mes e soma de dias", () => {
    expect(vezesNoMes(regra({ frequencia: "semanal", dia: 1 }), "2024-01-01")).toBe(5);
    expect(vezesNoMes(regra({ frequencia: "semanal", dia: 1 }), "2024-02-01")).toBe(4);
    expect(vezesNoMes(regra({}), "2024-02-01")).toBe(1);
    expect(somarDias("2024-02-28", 2)).toBe("2024-03-01");
    expect(somarDias("2023-12-31", 1)).toBe("2024-01-01");
  });
});
