import { describe, expect, it } from "vitest";
import {
  fluxoDeTeste,
  fontesFinanceirasDeTeste,
  INSIGHTS,
  LANCAMENTOS,
} from "../../eval/base-financas.js";
import {
  capacidadeDeAporte,
  compararMeses,
  filtrarLancamentos,
  gastosPorCategoria,
  simularCompra,
  sugerirCortes,
} from "./calculos.js";
import type { ResumoDoMes } from "./tipos.js";

const doMes = (mes: string) => LANCAMENTOS.filter((l) => l.data.startsWith(mes));
const resumo = async () =>
  (await fontesFinanceirasDeTeste().resumoDoMes("2026-10")).dados;

describe("gastosPorCategoria", () => {
  it("soma gastos realizados sem aporte nem previsto, do maior para o menor", () => {
    const r = gastosPorCategoria(doMes("2026-10"), 3);
    expect(r.total).toBe("4481.20");
    expect(r.categorias).toEqual([
      {
        categoria: "Moradia",
        valor: "2500.00",
        percentual: 55.8,
        lancamentos: 1,
        essencial: true,
      },
      {
        categoria: "Mercado",
        valor: "1100.00",
        percentual: 24.5,
        lancamentos: 1,
        essencial: true,
      },
      {
        categoria: "Compras",
        valor: "350.00",
        percentual: 7.8,
        lancamentos: 1,
        essencial: false,
      },
    ]);
    expect(r.outras).toEqual({ categorias: 4, valor: "531.20" });
  });

  it("sem gasto, total zero e sem outras", () => {
    const r = gastosPorCategoria([], 5);
    expect(r).toEqual({ total: "0.00", categorias: [], outras: null });
  });

  it("sem categoria vira 'Sem categoria'", () => {
    const [x] = LANCAMENTOS;
    const r = gastosPorCategoria(
      [{ ...x!, tipo: "despesa", categoria: null, valor: "10.00" }],
      5,
    );
    expect(r.categorias[0]?.categoria).toBe("Sem categoria");
  });
});

describe("compararMeses", () => {
  it("variacao por categoria, da maior mudanca para a menor", () => {
    const r = compararMeses(
      { mes: "2026-09", lancamentos: doMes("2026-09") },
      { mes: "2026-10", lancamentos: doMes("2026-10") },
      2,
    );
    expect(r.a).toEqual({ mes: "2026-09", gastos: "4208.10", renda: "8000.00" });
    expect(r.b.gastos).toBe("4481.20");
    expect(r.variacao).toBe("273.10");
    expect(r.variacao_percentual).toBe(6.5);
    expect(r.categorias).toEqual([
      {
        categoria: "Mercado",
        "2026-09": "880.00",
        "2026-10": "1100.00",
        variacao: "220.00",
        variacao_percentual: 25,
      },
      {
        categoria: "Restaurantes e delivery",
        "2026-09": "93.30",
        "2026-10": "146.40",
        variacao: "53.10",
        variacao_percentual: 56.9,
      },
    ]);
    expect(r.categorias_omitidas).toBe(5);
  });

  it("categoria nova no segundo mes nao tem percentual", () => {
    const r = compararMeses(
      { mes: "2026-07", lancamentos: doMes("2026-07") },
      { mes: "2026-09", lancamentos: doMes("2026-09") },
    );
    const outros = r.categorias.find((c) => c.categoria === "Outros");
    expect(outros).toMatchObject({ variacao: "300.00", variacao_percentual: null });
  });
});

describe("filtrarLancamentos", () => {
  it("acha pelo texto sem caixa e soma tudo o que casou", () => {
    const r = filtrarLancamentos(doMes("2026-10"), { busca: "ifood", limite: 2 });
    expect(r.quantidade).toBe(3);
    expect(r.soma_despesas).toBe("146.40");
    expect(r.mostrando).toBe(2);
    expect(r.lancamentos.map((l) => l.data)).toEqual(["2026-10-25", "2026-10-11"]);
  });

  it("filtra por categoria e tipo, e anonimiza PIX", () => {
    const outros = filtrarLancamentos(LANCAMENTOS, { categoria: "outros", limite: 10 });
    expect(outros.soma_despesas).toBe("600.00");
    expect(outros.lancamentos[0]?.descricao).toBe("PIX ENVIADO [pessoa]");
    const renda = filtrarLancamentos(LANCAMENTOS, { tipo: "receita", limite: 1 });
    expect(renda).toMatchObject({
      quantidade: 4,
      soma_receitas: "32000.00",
      soma_despesas: "0.00",
    });
  });

  it("ignora transferencias", () => {
    const [x] = LANCAMENTOS;
    const r = filtrarLancamentos([{ ...x!, tipo: "transferencia" }], { limite: 5 });
    expect(r.quantidade).toBe(0);
  });
});

describe("sugerirCortes", () => {
  it("atinge a meta so com nao essenciais, do maior para o menor", () => {
    const r = sugerirCortes(INSIGHTS, "100.00");
    expect(r.cortes.map((c) => [c.insight_id, c.economia_mensal])).toEqual([
      ["formiga-1", "73.20"],
      ["assinatura-netflix", "44.90"],
    ]);
    expect(r).toMatchObject({
      economia_mensal: "118.10",
      economia_anual: "1417.20",
      atinge_a_meta: true,
      falta: "0.00",
      usa_essenciais: false,
      candidatos_nao_usados: 2,
    });
  });

  it("so mexe em essencial quando os outros nao bastam; pontual nao entra", () => {
    const r = sugerirCortes(INSIGHTS, "500.00");
    expect(r.cortes.map((c) => c.insight_id)).toEqual([
      "formiga-1",
      "assinatura-netflix",
      "tarifas-1",
      "assinatura-plano",
    ]);
    expect(r.economia_mensal).toBe("758.00");
    expect(r.usa_essenciais).toBe(true);
    expect(r.cortes.some((c) => c.tipo === "fora_do_padrao")).toBe(false);
  });

  it("diz quanto falta quando nao da", () => {
    const r = sugerirCortes(INSIGHTS.slice(1, 3), "1000.00");
    expect(r).toMatchObject({
      atinge_a_meta: false,
      falta: "881.90",
      economia_mensal: "118.10",
    });
  });
});

describe("simularCompra", () => {
  it("cabe: parcela no fluxo a partir do mes seguinte e orcamento em atencao", async () => {
    const r = simularCompra({
      valor: "4000.00",
      parcelas: 10,
      fluxo: fluxoDeTeste(11),
      resumo: await resumo(),
    });
    expect(r.veredito).toBe("cabe");
    expect(r.valor_da_parcela).toBe("400.00");
    expect(r.meses[0]).toMatchObject({ parcela: "0.00", saldo_com_a_compra: "11820.00" });
    expect(r.meses[1]).toMatchObject({
      parcela: "400.00",
      saldo_com_a_compra: "13420.00",
    });
    expect(r.meses[10]).toMatchObject({
      saldo_sem_a_compra: "31820.00",
      saldo_com_a_compra: "27820.00",
    });
    expect(r.orcamento_de_referencia).toMatchObject({
      consumo_com_a_parcela: "5561.20",
      estado_com_a_parcela: "atencao",
    });
    expect(r.parcelas_sobre_a_renda.percentual).toBe(9.4);
  });

  it("apertado: estoura o orcamento e passa de 30% da renda", async () => {
    const r = simularCompra({
      valor: "30000.00",
      parcelas: 12,
      fluxo: fluxoDeTeste(13),
      resumo: await resumo(),
    });
    expect(r.veredito).toBe("apertado");
    expect(r.motivos).toEqual([
      "estoura_o_orcamento",
      "parcelas_acima_de_30_por_cento_da_renda",
    ]);
    expect(r.menor_saldo_com_a_compra).toEqual({ mes: "2027-10", saldo: "5820.00" });
  });

  it("nao cabe quando o saldo fica negativo; centavo do arredondamento na primeira", async () => {
    const r = simularCompra({
      valor: "100000.00",
      parcelas: 3,
      fluxo: fluxoDeTeste(6),
      resumo: await resumo(),
    });
    expect(r.veredito).toBe("nao_cabe");
    expect(r.primeira_parcela).toBe("33333.34");
    expect(r.valor_da_parcela).toBe("33333.33");
    expect(r.primeiro_mes_negativo_com_a_compra).toBe("2026-11");
  });

  it("saldo ja negativo e sem orcamento planejado", async () => {
    const base = await resumo();
    const semOrcamento: ResumoDoMes = {
      ...base,
      renda: { prevista: "0.00", recebida: "0.00" },
      orcamento: { planejado: "0.00", consumo: "0.00", percentual: null, estado: "ok" },
    };
    const fluxo = { ...fluxoDeTeste(6), primeiro_mes_negativo: "2026-12" };
    const r = simularCompra({ valor: "10.00", parcelas: 1, fluxo, resumo: semOrcamento });
    expect(r.motivos).toEqual(["saldo_ja_fica_negativo_sem_a_compra"]);
    expect(r.orcamento_de_referencia.estado_com_a_parcela).toBeNull();
    expect(r.parcelas_sobre_a_renda.percentual).toBeNull();
  });
});

describe("capacidadeDeAporte", () => {
  const tres = LANCAMENTOS.filter(
    (l) => l.data >= "2026-07-01" && l.data <= "2026-09-30",
  );
  const porMes = (total: string) =>
    ["2026-10", "2026-11", "2026-12"].map((mes) => ({ mes, total }));

  it("sobra media menos reserva de emergencia", () => {
    const r = capacidadeDeAporte({
      meses: ["2026-07", "2026-08", "2026-09"],
      lancamentos: tres,
      parcelas_futuras: porMes("350.00"),
      saldo_em_conta: "12000.00",
    });
    expect(r).toMatchObject({
      renda_media: "8000.00",
      despesa_media: "3975.90",
      sobra_media: "4024.10",
      compromissos_futuros: { parcelas_pagas_por_mes: "350.00", aumento_por_mes: "0.00" },
      reserva_de_emergencia: {
        essenciais_por_mes: "3410.00",
        alvo: "20460.00",
        falta: "8460.00",
        separar_por_mes: "705.00",
      },
      capacidade_mensal: "3319.10",
    });
    expect(r.proximo_passo).toContain("sugerir_aporte com valor 3319.10");
  });

  it("parcela nova que vem e reserva completa; sem sobra, aponta os cortes", () => {
    const comReserva = capacidadeDeAporte({
      meses: ["2026-07", "2026-08", "2026-09"],
      lancamentos: tres,
      parcelas_futuras: porMes("1350.00"),
      saldo_em_conta: "50000.00",
    });
    expect(comReserva.compromissos_futuros.aumento_por_mes).toBe("1000.00");
    expect(comReserva.reserva_de_emergencia.separar_por_mes).toBe("0.00");
    expect(comReserva.capacidade_mensal).toBe("3024.10");

    const semSobra = capacidadeDeAporte({
      meses: ["2026-07", "2026-08", "2026-09"],
      lancamentos: tres.filter((l) => l.tipo === "despesa"),
      parcelas_futuras: [],
      saldo_em_conta: "0.00",
    });
    expect(semSobra.capacidade_mensal).toBe("0.00");
    expect(semSobra.proximo_passo).toContain("sugerir_cortes");
  });
});
