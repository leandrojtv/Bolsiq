import { describe, expect, it } from "vitest";
import { cdiAnual, custoDeOportunidade } from "./oportunidade.js";

const CDI = { diaria: "0.050788", data: "2026-11-18", fonte: "bcb-sgs" };

describe("custoDeOportunidade", () => {
  it("CDI diario vira anual por 252 dias uteis", () => {
    expect(cdiAnual("0.050788")).toBeCloseTo(0.1365, 3);
    expect(cdiAnual("0")).toBe(0);
  });

  it("acumula o valor mensal em 5 e 10 anos, com a premissa e a data", () => {
    const c = custoDeOportunidade("100", CDI);
    expect(c.valor_mensal).toBe("100.00");
    expect(c.taxa_anual).toBe(13.65);
    expect(c.data_da_taxa).toBe("2026-11-18");
    expect(c.fonte).toBe("bcb-sgs");
    expect(c.premissa).toBe(
      "100% do CDI de 18/11/2026 (13,65% ao ano), aplicado todo mês, sem imposto e sem inflação.",
    );
    expect(c.em_5_anos.aportado).toBe("6000.00");
    expect(Number(c.em_5_anos.acumulado)).toBeGreaterThan(8300);
    expect(Number(c.em_5_anos.acumulado)).toBeLessThan(8400);
    expect(Number(c.em_10_anos.rendimento)).toBeGreaterThan(
      Number(c.em_10_anos.aportado),
    );
  });

  it("taxa zero acumula so o aportado", () => {
    const c = custoDeOportunidade("50", { ...CDI, diaria: "0" });
    expect(c.em_10_anos).toEqual({
      acumulado: "6000.00",
      aportado: "6000.00",
      rendimento: "0.00",
    });
  });
});
