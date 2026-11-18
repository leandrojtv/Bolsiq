import { describe, expect, it } from "vitest";
import { shiftDecimal } from "./decimal.js";

describe("shiftDecimal", () => {
  it("converte centavos em reais", () => {
    expect(shiftDecimal("1234", -2)).toBe("12.34");
    expect(shiftDecimal("0000000001234", -2)).toBe("12.34");
    expect(shiftDecimal("100", -2)).toBe("1");
    expect(shiftDecimal("1", -2)).toBe("0.01");
    expect(shiftDecimal("0", -2)).toBe("0");
  });

  it("aplica a escala MIL da CVM", () => {
    expect(shiftDecimal("1234", 3)).toBe("1234000");
    expect(shiftDecimal("1.5", 3)).toBe("1500");
    expect(shiftDecimal("0.001", 3)).toBe("1");
  });

  it("não perde precisão onde float perderia", () => {
    // 1234567890123 / 100 em double devolve 12345678901.23 com erro;
    // aqui o resultado é exato.
    expect(shiftDecimal("1234567890123", -2)).toBe("12345678901.23");
    expect(shiftDecimal("999999999999999999", -2)).toBe("9999999999999999.99");
  });

  it("preserva o sinal, sem produzir -0", () => {
    expect(shiftDecimal("-1234", -2)).toBe("-12.34");
    expect(shiftDecimal("-0", -2)).toBe("0");
    expect(shiftDecimal("-000", -2)).toBe("0");
  });

  it("deslocamento zero apenas normaliza", () => {
    expect(shiftDecimal("007.500", 0)).toBe("7.5");
    expect(shiftDecimal("0.0", 0)).toBe("0");
  });

  it("recusa entrada que não é decimal", () => {
    expect(() => shiftDecimal("12,34", -2)).toThrow();
    expect(() => shiftDecimal("1e3", -2)).toThrow();
    expect(() => shiftDecimal("", -2)).toThrow();
    expect(() => shiftDecimal(".", -2)).toThrow();
    expect(() => shiftDecimal("abc", 0)).toThrow();
  });
});
