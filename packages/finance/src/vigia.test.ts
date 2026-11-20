import { describe, expect, it } from "vitest";
import { validarPayload } from "@bolsiq/contracts";
import {
  faturasVencendo,
  limitesDoOrcamento,
  receitasAtrasadas,
  saldoNegativo,
  type FaturaAPagar,
  type Fato,
} from "./vigia.js";

const HOJE = "2026-11-20";

/** Todo fato vira um payload que o catalogo aceita (o outbox recusaria). */
const validos = (fatos: Fato[]) => {
  for (const f of fatos)
    expect(validarPayload(f.evento, { user_id: "u1", ...f.payload })).toMatchObject({
      ok: true,
    });
  return fatos;
};

const fatura = (o: Partial<FaturaAPagar>): FaturaAPagar => ({
  id: "f1",
  card_id: "k1",
  cartao: "Nubank",
  vencimento: "2026-11-23",
  status: "fechada",
  total: "1830.45",
  pagamentos: "0.00",
  ...o,
});

describe("fatura vence em 3 dias", () => {
  it("avisa com o valor que falta pagar e os dias", () => {
    const [f] = validos(faturasVencendo([fatura({ pagamentos: "30.45" })], HOJE));
    expect(f).toEqual({
      evento: "finance.fatura.vencendo.v1",
      chave: "fatura_vencendo:f1",
      payload: {
        chave: "fatura_vencendo:f1",
        statement_id: "f1",
        card_id: "k1",
        cartao: "Nubank",
        vencimento: "2026-11-23",
        valor: "1800.00",
        dias: 3,
      },
    });
  });

  it("vence hoje ainda avisa; daqui a 4 dias, ja venceu ou paga nao", () => {
    expect(faturasVencendo([fatura({ vencimento: HOJE })], HOJE)).toHaveLength(1);
    expect(faturasVencendo([fatura({ vencimento: "2026-11-24" })], HOJE)).toEqual([]);
    expect(faturasVencendo([fatura({ vencimento: "2026-11-19" })], HOJE)).toEqual([]);
    expect(faturasVencendo([fatura({ status: "paga" })], HOJE)).toEqual([]);
    expect(faturasVencendo([fatura({ pagamentos: "1830.45" })], HOJE)).toEqual([]);
    expect(faturasVencendo([fatura({ total: "0.00" })], HOJE)).toEqual([]);
  });
});

describe("orcamento da categoria em 80% e 100%", () => {
  const cat = (consumo: string, planejado = "600.00") => ({
    category_id: "c1",
    nome: "Restaurantes e delivery",
    natureza: "despesa" as const,
    planejado,
    consumo,
  });

  it("abaixo de 80% nao avisa", () => {
    expect(limitesDoOrcamento([cat("479.99")], "2026-11")).toEqual([]);
  });

  it("80% avisa uma vez, com chave por mes, categoria e limiar", () => {
    const fatos = validos(limitesDoOrcamento([cat("512.30")], "2026-11"));
    expect(fatos.map((f) => f.chave)).toEqual(["orcamento:2026-11:c1:80"]);
    expect(fatos[0]?.payload).toMatchObject({ limiar: 80, percentual: 85.4 });
  });

  it("estourado traz os dois limiares, o 100% primeiro", () => {
    const fatos = validos(limitesDoOrcamento([cat("720.00")], "2026-11"));
    expect(fatos.map((f) => f.payload.limiar)).toEqual([100, 80]);
  });

  it("receita, categoria sem planejado ou planejado zero nao entram", () => {
    expect(
      limitesDoOrcamento(
        [{ ...cat("9000.00"), natureza: "receita" }, cat("50.00", "0.00")],
        "2026-11",
      ),
    ).toEqual([]);
  });
});

describe("mes projetado com saldo negativo", () => {
  it("o primeiro mes negativo dos 3 proximos", () => {
    const fatos = validos(
      saldoNegativo([
        { mes: "2026-11", saldo_final: "350.00" },
        { mes: "2026-12", saldo_final: "-420.10" },
        { mes: "2027-01", saldo_final: "-900.00" },
      ]),
    );
    expect(fatos).toEqual([
      {
        evento: "finance.saldo.negativo.v1",
        chave: "saldo_negativo:2026-12",
        payload: {
          chave: "saldo_negativo:2026-12",
          mes: "2026-12",
          saldo_final: "-420.10",
        },
      },
    ]);
  });

  it("tudo positivo, ou negativo so depois do horizonte, nao avisa", () => {
    expect(saldoNegativo([{ mes: "2026-11", saldo_final: "0.00" }])).toEqual([]);
    expect(
      saldoNegativo([
        { mes: "2026-11", saldo_final: "1" },
        { mes: "2026-12", saldo_final: "1" },
        { mes: "2027-01", saldo_final: "1" },
        { mes: "2027-02", saldo_final: "-1" },
      ]),
    ).toEqual([]);
  });
});

describe("receita prevista atrasada", () => {
  const salario = { id: "t1", descricao: "Salario", valor: "6000", data: "2026-11-05" };

  it("data passada sem realizar: avisa com os dias de atraso", () => {
    const [f] = validos(receitasAtrasadas([salario], HOJE));
    expect(f?.chave).toBe("receita_atrasada:t1:2026-11-05");
    expect(f?.payload).toMatchObject({ valor: "6000.00", dias_de_atraso: 15 });
  });

  it("prevista para hoje ainda nao esta atrasada", () => {
    expect(receitasAtrasadas([{ ...salario, data: HOJE }], HOJE)).toEqual([]);
  });
});
