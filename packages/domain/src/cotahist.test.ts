import { describe, expect, it } from "vitest";
import {
  COTAHIST_LINE_LENGTH,
  isLotePadraoAVista,
  parseCotahistLine,
  parseCotahistPrice,
} from "./cotahist.js";

/** Monta uma linha de 245 bytes colocando cada campo na posição documentada. */
function montarLinha(campos: Record<string, [number, number, string]>): string {
  const buffer = Array.from({ length: COTAHIST_LINE_LENGTH }, () => " ");
  for (const [inicio, fim, valor] of Object.values(campos)) {
    const largura = fim - inicio + 1;
    const texto = valor
      .padStart(largura, valor.match(/^\d+$/) ? "0" : " ")
      .slice(0, largura);
    for (let i = 0; i < largura; i++) {
      buffer[inicio - 1 + i] = texto[i] ?? " ";
    }
  }
  return buffer.join("");
}

function linhaPetr4(overrides: Partial<Record<string, string>> = {}): string {
  return montarLinha({
    tipreg: [1, 2, overrides.tipreg ?? "01"],
    data: [3, 10, overrides.data ?? "20261031"],
    codbdi: [11, 12, overrides.codbdi ?? "02"],
    codneg: [13, 24, (overrides.codneg ?? "PETR4").padEnd(12, " ")],
    tpmerc: [25, 27, overrides.tpmerc ?? "010"],
    nomres: [28, 39, (overrides.nomres ?? "PETROBRAS").padEnd(12, " ")],
    especi: [40, 49, (overrides.especi ?? "PN").padEnd(10, " ")],
    preabe: [57, 69, overrides.preabe ?? "3800"],
    premax: [70, 82, overrides.premax ?? "3900"],
    premin: [83, 95, overrides.premin ?? "3750"],
    premed: [96, 108, overrides.premed ?? "3825"],
    preult: [109, 121, overrides.preult ?? "3842"],
    totneg: [148, 152, overrides.totneg ?? "1234"],
    quatot: [153, 170, overrides.quatot ?? "9876543"],
    voltot: [171, 188, overrides.voltot ?? "379482000"],
    fatcot: [211, 217, overrides.fatcot ?? "1"],
    codisi: [231, 242, (overrides.codisi ?? "BRPETRACNPR6").padEnd(12, " ")],
  });
}

describe("parseCotahistPrice", () => {
  it("aplica as duas decimais implícitas", () => {
    expect(parseCotahistPrice("0000000003842", 1)).toBe("38.42");
    expect(parseCotahistPrice("0000000000001", 1)).toBe("0.01");
  });

  it("divide pelo fator de cotação", () => {
    // FATCOT 1000: o preço é de um lote de mil papéis.
    expect(parseCotahistPrice("0000000003842", 1000)).toBe("0.03842");
    expect(parseCotahistPrice("0000001000000", 1000)).toBe("10");
  });

  it("recusa fator inválido ou que não seja potência de dez", () => {
    expect(() => parseCotahistPrice("3842", 0)).toThrow(/fator/);
    expect(() => parseCotahistPrice("3842", -1)).toThrow(/fator/);
    expect(() => parseCotahistPrice("3842", 7)).toThrow(/potência de dez/);
  });

  it("recusa campo não numérico", () => {
    expect(() => parseCotahistPrice("ABC", 1)).toThrow(/não numérico/);
  });
});

describe("isLotePadraoAVista", () => {
  it("aceita apenas lote padrão do mercado a vista", () => {
    expect(isLotePadraoAVista("02", "010")).toBe(true);
    // Sem esse filtro entram opções, termo, leilão e fracionário.
    expect(isLotePadraoAVista("02", "070")).toBe(false);
    expect(isLotePadraoAVista("96", "010")).toBe(false);
  });
});

describe("parseCotahistLine", () => {
  it("decodifica um registro de cotação", () => {
    const registro = parseCotahistLine(linhaPetr4());
    expect(registro).not.toBeNull();
    expect(registro).toMatchObject({
      date: "2026-10-31",
      ticker: "PETR4",
      codbdi: "02",
      tpmerc: "010",
      specification: "PN",
      open: "38",
      high: "39",
      low: "37.5",
      average: "38.25",
      close: "38.42",
      trades: 1234,
      financialVolume: "3794820",
      quoteFactor: 1,
      isin: "BRPETRACNPR6",
    });
    expect(registro?.volume).toBe(9876543n);
  });

  it("devolve null para header, trailer e linha vazia", () => {
    expect(parseCotahistLine(linhaPetr4({ tipreg: "00" }))).toBeNull();
    expect(parseCotahistLine(linhaPetr4({ tipreg: "99" }))).toBeNull();
    expect(parseCotahistLine("   ")).toBeNull();
  });

  it("aplica o fator de cotação aos preços, mas não ao volume financeiro", () => {
    const registro = parseCotahistLine(linhaPetr4({ fatcot: "1000" }));
    expect(registro?.close).toBe("0.03842");
    // VOLTOT é valor negociado, não preço unitário.
    expect(registro?.financialVolume).toBe("3794820");
    expect(registro?.quoteFactor).toBe(1000);
  });

  it("recusa linha curta", () => {
    expect(() => parseCotahistLine("01202610310" + " ".repeat(50))).toThrow(/bytes/);
  });

  it("recusa data malformada", () => {
    expect(() => parseCotahistLine(linhaPetr4({ data: "2026ABCD" }))).toThrow(/data/);
  });
});
