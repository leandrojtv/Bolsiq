import { describe, expect, it } from "vitest";
import {
  NovaTransacao,
  alinhar,
  ipcaMais6,
  retornoDaSerie,
  ultimos12Meses,
  umAnoAntes,
  dataCompleta,
  diaEMes,
  ehLayoutDePosicao,
  indexadorETaxa,
} from "./carteira-modelo";

describe("NovaTransacao", () => {
  it("aceita numero em pt-BR e normaliza o ticker", () => {
    const r = NovaTransacao.parse({
      ticker: " petr4 ",
      tipo: "compra",
      data: "2024-01-15",
      quantidade: "100",
      preco: "35,00",
      taxas: "1.234,5",
    });
    expect(r).toMatchObject({ ticker: "PETR4", preco: "35.00", taxas: "1234.5" });
  });

  it("compra exige preco; desdobramento nao", () => {
    expect(
      NovaTransacao.safeParse({
        ticker: "PETR4",
        tipo: "compra",
        data: "2024-01-15",
        quantidade: "1",
        preco: "0",
      }).success,
    ).toBe(false);
    expect(
      NovaTransacao.safeParse({
        ticker: "PETR4",
        tipo: "desdobramento",
        data: "2024-06-10",
        quantidade: "2",
        preco: "0",
      }).success,
    ).toBe(true);
    expect(
      NovaTransacao.safeParse({
        ticker: "PETR4",
        tipo: "compra",
        data: "15/01/2024",
        quantidade: "1",
        preco: "1",
      }).success,
    ).toBe(false);
    expect(
      NovaTransacao.safeParse({
        ticker: "PETR4",
        tipo: "compra",
        data: "2024-01-15",
        quantidade: "abc",
        preco: "1",
      }).success,
    ).toBe(false);
  });
});

describe("datas", () => {
  it("12 meses terminando no mes atual, com zero nos vazios", () => {
    const m = ultimos12Meses(
      [
        { mes: "2026-03", valor: "10.50" },
        { mes: "2024-01", valor: "9" },
      ],
      "2026-11-03",
    );
    expect(m).toHaveLength(12);
    expect(m[0]?.mes).toBe("2025-12");
    expect(m.at(-1)?.mes).toBe("2026-11");
    expect(m.find((x) => x.mes === "2026-03")?.valor).toBe(10.5);
  });

  it("um ano antes", () => {
    expect(umAnoAntes("2026-11-03")).toBe("2025-11-03");
  });
});

describe("benchmarks", () => {
  it("alinha com repeticao do ultimo valor e base 100", () => {
    const s = alinhar(
      ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-05"],
      [
        { date: "2024-01-02", valor: 50 },
        { date: "2024-01-04", valor: 55 },
      ],
    );
    expect(s.slice(0, 3)).toEqual([null, 100, 100]);
    expect(s[3]).toBeCloseTo(110, 10);
    expect(retornoDaSerie(s)).toBeCloseTo(0.1, 10);
    expect(retornoDaSerie([null])).toBeNull();
  });

  it("IPCA + 6% compoe mes a mes", () => {
    const n = ipcaMais6([
      { date: "2024-02-01", value: "0" },
      { date: "2024-01-01", value: "1" },
    ]);
    expect(n[0]?.valor).toBeCloseTo(1.01 * Math.pow(1.06, 1 / 12), 12);
    expect(n[1]?.valor).toBeCloseTo(1.01 * Math.pow(1.06, 2 / 12), 12);
  });
});

describe("ehLayoutDePosicao", () => {
  it("reconhece pelo cabecalho, com qualquer separador e com BOM", () => {
    expect(ehLayoutDePosicao("data_posicao,corretora,classe\n1,2,3")).toBe(true);
    expect(ehLayoutDePosicao("\uFEFFDATA_POSICAO;classe\r\n1;2")).toBe(true);
  });

  it("nao confunde com transacoes nem com o extrato da B3", () => {
    expect(ehLayoutDePosicao("data;ticker;tipo;quantidade;preco")).toBe(false);
    expect(ehLayoutDePosicao("data_posicao;corretora")).toBe(false);
    expect(ehLayoutDePosicao("")).toBe(false);
  });
});

describe("datas de extrato", () => {
  it("formata sem passar por fuso", () => {
    expect(diaEMes("2026-11-05")).toBe("05/11");
    expect(dataCompleta("2027-01-01")).toBe("01/01/2027");
  });
});

describe("indexadorETaxa", () => {
  const nulos = { indexador: null, pct_indexador: null, taxa_aa: null };
  it("mostra o que a linha rende", () => {
    expect(indexadorETaxa({ ...nulos, indexador: "CDI", pct_indexador: "1.20" })).toBe(
      "120% CDI",
    );
    expect(indexadorETaxa({ ...nulos, indexador: "IPCA", taxa_aa: "0.0795" })).toBe(
      "IPCA + 7,95%",
    );
    expect(indexadorETaxa({ ...nulos, indexador: "PRE", taxa_aa: "0.1469" })).toBe(
      "14,69% a.a.",
    );
    expect(indexadorETaxa({ ...nulos, pct_indexador: "1" })).toBe("100%");
    expect(indexadorETaxa({ ...nulos, indexador: "SELIC" })).toBe("SELIC");
    expect(indexadorETaxa(nulos)).toBe("-");
  });
});
