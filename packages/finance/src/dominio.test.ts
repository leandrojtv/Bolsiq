import { describe, expect, it } from "vitest";
import {
  competenciaDe,
  efeitoNoSaldo,
  montarTransferencia,
  normalizarDescricao,
  saldoNaData,
  totaisDoMes,
} from "./dominio.js";
import type { LancamentoBase } from "./tipos.js";

const l = (p: Partial<LancamentoBase>): LancamentoBase => ({
  tipo: "despesa",
  valor: "10.00",
  data: "2026-03-10",
  competencia: "2026-03-01",
  status: "realizado",
  transferencia_sentido: null,
  ...p,
});

describe("competenciaDe", () => {
  it("devolve o primeiro dia do mes", () => {
    expect(competenciaDe("2026-02-28")).toBe("2026-02-01");
    expect(competenciaDe("2024-12-31")).toBe("2024-12-01");
  });
  it("recusa data malformada", () => {
    expect(() => competenciaDe("2026-2-1")).toThrow(/data invalida/);
  });
});

describe("normalizarDescricao", () => {
  it("tira acento, pontuacao e espacos repetidos", () => {
    expect(normalizarDescricao("  Pão de  Açúcar - São Paulo!! ")).toBe(
      "PAO DE ACUCAR SAO PAULO",
    );
  });
});

describe("efeitoNoSaldo", () => {
  it("receita soma, despesa subtrai", () => {
    expect(efeitoNoSaldo(l({ tipo: "receita", valor: "100.50" }))).toBe("100.50");
    expect(efeitoNoSaldo(l({ tipo: "despesa", valor: "100.50" }))).toBe("-100.50");
  });
  it("transferencia segue o sentido", () => {
    expect(
      efeitoNoSaldo(l({ tipo: "transferencia", transferencia_sentido: "entrada" })),
    ).toBe("10.00");
    expect(
      efeitoNoSaldo(l({ tipo: "transferencia", transferencia_sentido: "saida" })),
    ).toBe("-10.00");
  });
  it("transferencia sem sentido e erro", () => {
    expect(() => efeitoNoSaldo(l({ tipo: "transferencia" }))).toThrow(/sem sentido/);
  });
});

describe("saldoNaData", () => {
  const conta = { saldo_inicial: "1000.00", data_saldo_inicial: "2026-03-01" };
  const lancamentos = [
    l({ tipo: "despesa", valor: "0.10", data: "2026-03-01" }),
    l({ tipo: "despesa", valor: "0.20", data: "2026-03-01" }),
    l({ tipo: "receita", valor: "500.00", data: "2026-03-05" }),
    l({ tipo: "despesa", valor: "200.00", data: "2026-03-20", status: "previsto" }),
    l({ tipo: "despesa", valor: "50.00", data: "2026-03-06", status: "conciliado" }),
    // Antes do saldo inicial: ja esta dentro dele.
    l({ tipo: "despesa", valor: "999.00", data: "2026-02-28" }),
  ];

  it("soma com decimal, sem erro de ponto flutuante", () => {
    expect(saldoNaData(conta, lancamentos, "2026-03-01")).toBe("999.70");
  });
  it("conta so ate a data, realizado e conciliado", () => {
    expect(saldoNaData(conta, lancamentos, "2026-03-31")).toBe("1449.70");
  });
  it("com previstos, e o saldo previsto", () => {
    expect(saldoNaData(conta, lancamentos, "2026-03-31", { incluirPrevistos: true })).toBe(
      "1249.70",
    );
  });
  it("antes do saldo inicial nao ha saldo conhecido", () => {
    expect(saldoNaData(conta, lancamentos, "2026-02-28")).toBeNull();
  });
  it("transferencia move o saldo das duas contas e o total fica igual", () => {
    const [saida, entrada] = montarTransferencia(
      {
        de: "a",
        para: "b",
        valor: "300",
        data: "2026-03-10",
        descricao: "Reserva",
        status: "realizado",
      },
      { saida: "s", entrada: "e" },
    );
    const a = saldoNaData(conta, [saida], "2026-03-31");
    const b = saldoNaData(conta, [entrada], "2026-03-31");
    expect([a, b]).toEqual(["700.00", "1300.00"]);
  });
});

describe("totaisDoMes", () => {
  const lancamentos = [
    l({ tipo: "receita", valor: "5000.00", status: "realizado" }),
    l({ tipo: "receita", valor: "300.00", status: "previsto" }),
    l({ tipo: "despesa", valor: "1200.00", status: "conciliado" }),
    l({ tipo: "despesa", valor: "800.00", status: "previsto" }),
    l({ tipo: "transferencia", valor: "2000.00", transferencia_sentido: "saida" }),
    l({ tipo: "transferencia", valor: "2000.00", transferencia_sentido: "entrada" }),
    l({ tipo: "despesa", valor: "99.00", competencia: "2026-04-01" }),
  ];

  it("separa natureza e status e ignora outro mes", () => {
    expect(totaisDoMes(lancamentos, "2026-03-01")).toEqual({
      competencia: "2026-03-01",
      receita: { previsto: "300.00", realizado: "5000.00", total: "5300.00" },
      despesa: { previsto: "800.00", realizado: "1200.00", total: "2000.00" },
      resultado: "3300.00",
    });
  });
  it("transferencia nunca conta como receita nem despesa", () => {
    const so = totaisDoMes(
      lancamentos.filter((x) => x.tipo === "transferencia"),
      "2026-03-01",
    );
    expect(so.receita.total).toBe("0.00");
    expect(so.despesa.total).toBe("0.00");
  });
});

describe("montarTransferencia", () => {
  const pedido = {
    de: "a",
    para: "b",
    valor: "10.5",
    data: "2026-01-31",
    descricao: "Para a poupança",
    status: "realizado" as const,
  };
  it("monta o par, um apontando para o outro", () => {
    const [s, e] = montarTransferencia(pedido, { saida: "s", entrada: "e" });
    expect(s).toMatchObject({
      id: "s",
      account_id: "a",
      transferencia_par_id: "e",
      transferencia_sentido: "saida",
      valor: "10.50",
      competencia: "2026-01-01",
      descricao_normalizada: "PARA A POUPANCA",
      category_id: null,
      observacao: null,
    });
    expect(e).toMatchObject({
      id: "e",
      account_id: "b",
      transferencia_par_id: "s",
      transferencia_sentido: "entrada",
    });
  });
  it("recusa mesma conta e valor nao positivo", () => {
    expect(() => montarTransferencia({ ...pedido, para: "a" }, { saida: "s", entrada: "e" })).toThrow(
      /mesma conta/,
    );
    expect(() => montarTransferencia({ ...pedido, valor: "0" }, { saida: "s", entrada: "e" })).toThrow(
      /positivo/,
    );
  });
});
