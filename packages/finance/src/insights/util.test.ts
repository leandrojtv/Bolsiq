import { describe, expect, it } from "vitest";
import { d } from "../decimal.js";
import {
  brl,
  diasEntre,
  fimDoMes,
  idDeInsight,
  inicioDoMes,
  mad,
  mediana,
  pct,
} from "./util.js";

describe("util dos insights", () => {
  it("mediana e MAD", () => {
    expect(mediana([]).toString()).toBe("0");
    expect(mediana(["3", "1", "2"].map(d)).toString()).toBe("2");
    expect(mediana(["4", "1", "2", "3"].map(d)).toString()).toBe("2.5");
    expect(mad(["1", "1", "2", "2", "4", "6", "9"].map(d)).toString()).toBe("1");
  });

  it("datas", () => {
    expect(diasEntre("2026-02-27", "2026-03-01")).toBe(2);
    expect(inicioDoMes("2026-01", -2)).toBe("2025-11-01");
    expect(fimDoMes("2024-02")).toBe("2024-02-29");
    expect(fimDoMes("2026-12")).toBe("2026-12-31");
  });

  it("id estavel e curto", () => {
    expect(idDeInsight("assinatura", "NETFLIX")).toBe(
      idDeInsight("assinatura", "NETFLIX"),
    );
    expect(idDeInsight("assinatura", "NETFLIX")).not.toBe(
      idDeInsight("assinatura", "SPOTIFY"),
    );
    expect(idDeInsight("formiga", "90d")).toMatch(/^formiga-[0-9a-z]{1,7}$/);
  });

  it("formatacao", () => {
    expect(brl("1234.5")).toBe("R$ 1.234,50");
    expect(pct(d(1), d(0))).toBeNull();
    expect(pct(d(1), d(3))).toBe(33.3);
  });
});
