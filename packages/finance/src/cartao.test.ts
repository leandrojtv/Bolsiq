import { describe, expect, it } from "vitest";
import { faturaDaCompra, faturaDoMes, faturasAoRedor } from "./cartao.js";

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

  it("compra antes do fechamento entra nesta; no dia ou depois, na seguinte", () => {
    expect(faturaDaCompra(nubank, "2023-11-02").vencimento).toBe("2023-11-10");
    expect(faturaDaCompra(nubank, "2023-11-03").vencimento).toBe("2023-12-10");
    expect(faturaDaCompra(virada, "2023-11-20").vencimento).toBe("2023-12-05");
    expect(faturaDaCompra(virada, "2023-11-26").vencimento).toBe("2024-01-05");
    expect(faturaDaCompra(virada, "2023-12-31").vencimento).toBe("2024-02-05");
  });

  it("faturas ao redor de hoje", () => {
    const lista = faturasAoRedor(nubank, "2023-11-15", 2, 1).map((f) => f.vencimento);
    expect(lista).toEqual(["2023-10-10", "2023-11-10", "2023-12-10", "2024-01-10"]);
  });
});
