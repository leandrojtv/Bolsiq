import { describe, expect, it } from "vitest";
import {
  competenciaDaFatura,
  faturaDaCompra,
  faturaDoMes,
  faturasAoRedor,
  fechou,
} from "./cartao.js";

describe("ciclo da fatura", () => {
  const nubank = { dia_fechamento: 3, dia_vencimento: 10 };
  const virada = { dia_fechamento: 25, dia_vencimento: 5 };

  it("fechamento no mesmo mes ou no anterior", () => {
    expect(faturaDoMes(nubank, 2023, 11)).toEqual({
      vencimento: "2023-11-10",
      fechamento: "2023-11-03",
    });
    expect(faturaDoMes(virada, 2024, 1)).toEqual({
      vencimento: "2024-01-05",
      fechamento: "2023-12-25",
    });
  });

  it("dia 31 vira o ultimo dia do mes", () => {
    expect(faturaDoMes({ dia_fechamento: 31, dia_vencimento: 10 }, 2024, 3)).toEqual({
      vencimento: "2024-03-10",
      fechamento: "2024-02-29",
    });
  });

  it("compra ate o dia do fechamento entra no ciclo; depois, na seguinte", () => {
    expect(faturaDaCompra(nubank, "2023-11-02").vencimento).toBe("2023-11-10");
    expect(faturaDaCompra(nubank, "2023-11-03").vencimento).toBe("2023-11-10");
    expect(faturaDaCompra(nubank, "2023-11-04").vencimento).toBe("2023-12-10");
    expect(faturaDaCompra(virada, "2023-11-20").vencimento).toBe("2023-12-05");
    expect(faturaDaCompra(virada, "2023-11-25").vencimento).toBe("2023-12-05");
    expect(faturaDaCompra(virada, "2023-11-26").vencimento).toBe("2024-01-05");
    expect(faturaDaCompra(virada, "2023-12-31").vencimento).toBe("2024-02-05");
  });

  it("fevereiro e virada de ano com dias 30 e 31", () => {
    const fim = { dia_fechamento: 31, dia_vencimento: 30 };
    // Fecha em 31/01, vence em 29/02 (bissexto).
    expect(faturaDaCompra(fim, "2024-01-31")).toEqual({
      vencimento: "2024-02-29",
      fechamento: "2024-01-31",
    });
    // Fecha no ultimo dia de fevereiro (28 em 2023), vence em 30/03.
    expect(faturaDaCompra(fim, "2023-02-28")).toEqual({
      vencimento: "2023-03-30",
      fechamento: "2023-02-28",
    });
    expect(faturaDaCompra(fim, "2023-03-01").vencimento).toBe("2023-04-30");
    expect(faturaDaCompra(fim, "2023-12-31")).toEqual({
      vencimento: "2024-01-30",
      fechamento: "2023-12-31",
    });
  });

  it("competencia e fechamento", () => {
    const f = faturaDoMes(nubank, 2023, 11);
    expect(competenciaDaFatura(f)).toBe("2023-11-01");
    expect(fechou(f, "2023-11-03")).toBe(false);
    expect(fechou(f, "2023-11-04")).toBe(true);
  });

  it("faturas ao redor de hoje", () => {
    const lista = faturasAoRedor(nubank, "2023-11-15", 2, 1).map((f) => f.vencimento);
    expect(lista).toEqual(["2023-10-10", "2023-11-10", "2023-12-10", "2024-01-10"]);
  });
});
