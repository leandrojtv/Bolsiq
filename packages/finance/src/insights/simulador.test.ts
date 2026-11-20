import { describe, expect, it } from "vitest";
import { simularCortes, type BaseDoSimulador } from "./simulador.js";

const base: BaseDoSimulador = {
  assinaturas: [
    { id: "assinatura-a", nome: "Netflix", valor_mensal: "39.90" },
    { id: "assinatura-b", nome: "Spotify", valor_mensal: "21.90" },
  ],
  categorias: [{ category_id: "Lazer", nome: "Lazer", media_mensal: "600.00" }],
  formiga: { mensal: "120.00" },
  fluxo: {
    saldo_inicial: "1000.00",
    meses: [
      { mes: "2026-11", entradas: "5000.00", saidas: "5500.00", saldo_final: "500.00" },
      { mes: "2026-12", entradas: "5000.00", saidas: "5600.00", saldo_final: "-100.00" },
      { mes: "2027-01", entradas: "5000.00", saidas: "5100.00", saldo_final: "-200.00" },
    ],
    primeiro_mes_negativo: "2026-12",
  },
  metas: [
    { id: "m1", nome: "Viagem", falta: "6000.00", valor_mensal_necessario: "500.00" },
    { id: "m2", nome: "Reserva", falta: "0.00", valor_mensal_necessario: "0.00" },
  ],
  cdi: { diaria: "0.050788", data: "2026-11-18", fonte: "bcb-sgs" },
};

describe("simularCortes", () => {
  it("soma a economia, projeta o fluxo e antecipa as metas", () => {
    const r = simularCortes(base, [
      { tipo: "assinatura", id: "assinatura-a" },
      { tipo: "categoria", category_id: "Lazer", reducao_pct: 20 },
      { tipo: "formiga", reducao_pct: 50 },
    ]);
    expect(r.itens).toEqual([
      {
        tipo: "assinatura",
        id: "assinatura-a",
        nome: "Netflix",
        economia_mensal: "39.90",
      },
      { tipo: "categoria", id: "Lazer", nome: "Lazer (-20%)", economia_mensal: "120.00" },
      {
        tipo: "formiga",
        id: "formiga",
        nome: "Efeito formiga (-50%)",
        economia_mensal: "60.00",
      },
    ]);
    expect(r.economia_mensal).toBe("219.90");
    expect(r.economia_anual).toBe("2638.80");
    // A economia entra a partir do mes seguinte.
    expect(r.fluxo.novo.meses.map((m) => m.saldo_final)).toEqual([
      "500.00",
      "119.90",
      "239.80",
    ]);
    expect(r.fluxo.novo.meses[1]?.saidas).toBe("5380.10");
    expect(r.fluxo.novo.primeiro_mes_negativo).toBeNull();
    expect(r.fluxo.base).toBe(base.fluxo);
    expect(r.metas).toEqual([
      { id: "m1", nome: "Viagem", meses_base: 12, meses_com_corte: 9, meses_antes: 3 },
      { id: "m2", nome: "Reserva", meses_base: 0, meses_com_corte: 0, meses_antes: 0 },
    ]);
    expect(r.oportunidade?.valor_mensal).toBe("219.90");
  });

  it("ignora item que nao existe, limita a reducao e sem CDI nao calcula oportunidade", () => {
    const r = simularCortes({ ...base, formiga: null, cdi: null }, [
      { tipo: "assinatura", id: "nao-existe" },
      { tipo: "categoria", category_id: "Outra", reducao_pct: 10 },
      { tipo: "categoria", category_id: "Lazer", reducao_pct: 150 },
      { tipo: "formiga", reducao_pct: 50 },
    ]);
    expect(r.itens.map((i) => i.economia_mensal)).toEqual(["600.00"]);
    expect(r.oportunidade).toBeNull();
    expect(r.fluxo.novo.meses[1]?.saidas).toBe("5000.00");
  });

  it("sem corte, o fluxo novo e o de base e a saida nao fica negativa", () => {
    const r = simularCortes(base, []);
    expect(r.economia_mensal).toBe("0.00");
    expect(r.fluxo.novo.primeiro_mes_negativo).toBe("2026-12");
    expect(r.oportunidade).toBeNull();
    const grande = simularCortes(
      { ...base, categorias: [{ category_id: "X", nome: "X", media_mensal: "9000.00" }] },
      [{ tipo: "categoria", category_id: "X", reducao_pct: 100 }],
    );
    expect(grande.fluxo.novo.meses[1]?.saidas).toBe("0.00");
  });
});
