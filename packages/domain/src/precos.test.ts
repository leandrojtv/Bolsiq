import { describe, expect, it } from "vitest";
import { agregarVelas, ajustarPorProventos, type Vela } from "./precos.js";

const v = (date: string, close: string, volume = 100): Vela => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume,
  financial_volume: "1000",
});

describe("ajustarPorProventos", () => {
  const serie = [v("2024-01-02", "10"), v("2024-01-03", "10"), v("2024-01-04", "9")];

  it("sem evento devolve a serie como esta", () => {
    expect(ajustarPorProventos(serie, [])).toBe(serie);
  });

  it("dividendo multiplica o passado por 1 - D/P e preserva o presente", () => {
    const r = ajustarPorProventos(serie, [
      { exDate: "2024-01-04", kind: "dividendo", valuePerShare: "1", factor: null },
    ]);
    expect(r.map((x) => x.close)).toEqual(["9", "9", "9"]);
  });

  it("desdobramento divide preco e multiplica volume", () => {
    const r = ajustarPorProventos(serie, [
      { exDate: "2024-01-03", kind: "desdobramento", valuePerShare: null, factor: "2" },
    ]);
    expect(r[0]).toMatchObject({ close: "5", volume: 200 });
    expect(r[1]).toMatchObject({ close: "10", volume: 100 });
  });

  it("grupamento multiplica preco", () => {
    const r = ajustarPorProventos(serie, [
      { exDate: "2024-01-04", kind: "grupamento", valuePerShare: null, factor: "0.1" },
    ]);
    expect(r[0]?.close).toBe("100");
    expect(r[2]?.close).toBe("9");
  });

  it("compoe eventos em sequencia usando o preco bruto de cada data", () => {
    const r = ajustarPorProventos(serie, [
      { exDate: "2024-01-03", kind: "jcp", valuePerShare: "1", factor: null },
      { exDate: "2024-01-04", kind: "dividendo", valuePerShare: "1", factor: null },
    ]);
    // 10 * (1 - 1/10) * (1 - 1/10) = 8.1
    expect(r[0]?.close).toBe("8.1");
    expect(r[1]?.close).toBe("9");
  });

  it("ignora evento incoerente em vez de gerar preco negativo", () => {
    const r = ajustarPorProventos(serie, [
      { exDate: "2024-01-04", kind: "dividendo", valuePerShare: "50", factor: null },
      { exDate: "2024-01-04", kind: "desdobramento", valuePerShare: null, factor: "0" },
      { exDate: "2024-01-04", kind: "jcp", valuePerShare: null, factor: null },
      { exDate: "2024-01-04", kind: "bonificacao", valuePerShare: null, factor: null },
    ]);
    expect(r.map((x) => x.close)).toEqual(["10", "10", "9"]);
  });

  it("evento antes do inicio da serie nao muda nada", () => {
    const r = ajustarPorProventos(serie, [
      { exDate: "2023-01-01", kind: "dividendo", valuePerShare: "1", factor: null },
    ]);
    expect(r.map((x) => x.close)).toEqual(["10", "10", "9"]);
  });
});

describe("agregarVelas", () => {
  const dias: Vela[] = [
    { ...v("2024-01-30", "10"), high: "11", low: "9" },
    { ...v("2024-01-31", "12"), high: "13", low: "10" },
    { ...v("2024-02-01", "8"), high: "9", low: "7" },
    { ...v("2024-02-05", "9"), high: "9.5", low: "8.5" },
  ];

  it("1d devolve a propria serie", () => {
    expect(agregarVelas(dias, "1d")).toBe(dias);
  });

  it("semanal agrupa de segunda a domingo", () => {
    const r = agregarVelas(dias, "1wk");
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({
      date: "2024-01-30",
      open: "10",
      high: "13",
      low: "7",
      close: "8",
      volume: 300,
      financial_volume: "3000",
    });
    expect(r[1]?.date).toBe("2024-02-05");
  });

  it("mensal agrupa por mes de calendario", () => {
    const r = agregarVelas(dias, "1mo");
    expect(r.map((x) => [x.date, x.close])).toEqual([
      ["2024-01-30", "12"],
      ["2024-02-01", "9"],
    ]);
  });

  it("serie vazia fica vazia", () => {
    expect(agregarVelas([], "1mo")).toEqual([]);
  });
});
