import { describe, expect, it } from "vitest";
import {
  diasDePregao,
  eventosAplicados,
  fluxoDaTransacao,
  snapshotsDiarios,
} from "./snapshot.js";
import type { Transacao } from "./tipos.js";

const t = (p: Partial<Transacao> & Pick<Transacao, "tipo" | "data">): Transacao => ({
  id: `${p.data}-${p.tipo}`,
  ticker: "PETR4",
  quantidade: "10",
  preco: "10",
  taxas: "0",
  ...p,
});

describe("fluxoDaTransacao", () => {
  it("compra entra com a taxa, venda e provento saem liquidos", () => {
    expect(
      fluxoDaTransacao(t({ tipo: "compra", data: "2024-01-02", taxas: "1" })).toString(),
    ).toBe("101");
    expect(
      fluxoDaTransacao(t({ tipo: "venda", data: "2024-01-02", taxas: "1" })).toString(),
    ).toBe("-99");
    expect(
      fluxoDaTransacao(
        t({ tipo: "provento", data: "2024-01-02", preco: "0.5" }),
      ).toString(),
    ).toBe("-5");
    expect(
      fluxoDaTransacao(
        t({ tipo: "desdobramento", data: "2024-01-02", quantidade: "2", preco: "0" }),
      ).toString(),
    ).toBe("0");
  });
});

describe("diasDePregao", () => {
  it("une as datas das series dentro da janela", () => {
    const dias = diasDePregao(
      {
        A: [
          { date: "2024-01-02", close: "1" },
          { date: "2024-01-03", close: "1" },
        ],
        B: [
          { date: "2024-01-03", close: "1" },
          { date: "2024-01-05", close: "1" },
        ],
      },
      "2024-01-03",
      "2024-01-04",
    );
    expect(dias).toEqual(["2024-01-03"]);
  });
});

describe("snapshotsDiarios", () => {
  const fechamentos = {
    PETR4: [
      { date: "2024-01-04", close: "11" },
      { date: "2024-01-02", close: "10" },
      { date: "2024-01-03", close: "11" },
    ],
  };
  const dias = ["2024-01-02", "2024-01-03", "2024-01-04"];

  it("valor, custo, fluxo e TWR por dia", () => {
    const s = snapshotsDiarios(
      [
        t({ tipo: "compra", data: "2024-01-02", taxas: "1" }),
        // Sabado: cai no pregao seguinte da lista.
        t({ tipo: "provento", data: "2024-01-03", preco: "0.2" }),
        t({ tipo: "venda", data: "2024-01-04", preco: "11" }),
      ],
      fechamentos,
      dias,
    );
    expect(s.map((l) => l.valor_bruto)).toEqual(["100.00", "110.00", "0.00"]);
    expect(s[0]).toMatchObject({
      custo_total: "101.00",
      fluxo_caixa: "101.00",
      retorno_twr: null,
    });
    // Dia 2: 110 + 2 de provento sobre 100.
    expect(s[1]?.retorno_twr).toBeCloseTo(0.12, 10);
    expect(s[1]?.proventos_acumulados).toBe("2.00");
    // Dia 3: vende tudo a 11, sem variacao: retorno zero, nao -100%.
    expect(s[2]?.retorno_twr).toBeCloseTo(0, 10);
    expect(s[2]?.resultado_realizado_acumulado).toBe("9.00");
    expect(s[2]?.base_100).toBeCloseTo(112, 6);
  });

  it("ativo sem fechamento entra pelo custo", () => {
    const s = snapshotsDiarios(
      [t({ tipo: "compra", data: "2024-01-02", ticker: "NOVO3" })],
      fechamentos,
      ["2024-01-02"],
    );
    expect(s[0]?.valor_bruto).toBe("100.00");
    expect(s[0]?.resultado_nao_realizado).toBe("0.00");
  });
});

describe("eventosAplicados", () => {
  it("descreve o ultimo evento de cada ativo", () => {
    const avisos = eventosAplicados([
      t({ tipo: "desdobramento", data: "2024-06-10", quantidade: "2", preco: "0" }),
      t({
        tipo: "grupamento",
        data: "2024-01-10",
        ticker: "MGLU3",
        quantidade: "10",
        preco: "0",
      }),
      t({
        tipo: "bonificacao",
        data: "2024-01-10",
        ticker: "ITSA4",
        quantidade: "1",
        preco: "0",
      }),
      t({ tipo: "compra", data: "2024-01-10", ticker: "VALE3" }),
    ]);
    expect(Object.fromEntries(avisos)).toEqual({
      PETR4: "Desdobramento 1:2 aplicado",
      MGLU3: "Grupamento 10:1 aplicado",
      ITSA4: "Bonificação aplicada",
    });
  });
});
