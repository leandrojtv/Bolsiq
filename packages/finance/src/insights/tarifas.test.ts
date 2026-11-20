import { describe, expect, it } from "vitest";
import { CATEGORIAS, contexto, lanc, serie } from "./fabrica.js";
import { ehTarifa, tarifasEJuros, tipoDeTarifa } from "./tarifas.js";

describe("tarifasEJuros", () => {
  it("soma 12 meses de tarifas e juros, com rotativo e multa em destaque", () => {
    const ls = [
      ...serie("Tarifa Pacote Servicos", "45.00", [
        "2026-06-10",
        "2026-07-10",
        "2026-08-10",
      ]),
      lanc({ descricao: "Juros Rotativo", valor: "180.00", data: "2026-10-15" }),
      lanc({ descricao: "Multa Atraso Fatura", valor: "12.00", data: "2026-10-15" }),
      lanc({
        descricao: "Compra Internacional",
        valor: "6.38",
        data: "2026-09-01",
        category_id: "IOF",
      }),
      lanc({
        descricao: "Ajuste",
        valor: "20.00",
        data: "2026-08-20",
        category_id: "Juros e encargos",
      }),
      lanc({ descricao: "Anuidade Diferenciada", valor: "39.00", data: "2026-11-02" }),
      // Fora: mais de 12 meses, receita (estorno) e compra comum.
      lanc({ descricao: "Tarifa Antiga", valor: "99.00", data: "2025-10-01" }),
      lanc({
        tipo: "receita",
        descricao: "Estorno Tarifa",
        valor: "45.00",
        data: "2026-09-01",
      }),
      lanc({
        descricao: "Mercado",
        valor: "300.00",
        data: "2026-10-01",
        category_id: "Mercado",
      }),
    ];
    const [t, ...resto] = tarifasEJuros(contexto(ls));
    expect(resto).toEqual([]);
    expect(t).toMatchObject({
      tipo: "tarifas",
      impacto_anual: "392.38",
      impacto_mensal: "32.70",
      severidade: "alta",
      periodo: { inicio: "2025-11-21", fim: "2026-11-20" },
    });
    expect(t?.evidencias).toHaveLength(8);
    expect(t?.dados.rotativo).toBe("180.00");
    expect(t?.dados.multa).toBe("12.00");
    expect(t?.dados.por_tipo).toEqual([
      { tipo: "rotativo", rotulo: "Juros do rotativo", valor: "180.00", lancamentos: 1 },
      {
        tipo: "multa",
        rotulo: "Multa e mora por atraso",
        valor: "12.00",
        lancamentos: 1,
      },
      { tipo: "juros", rotulo: "Juros e encargos", valor: "20.00", lancamentos: 1 },
      { tipo: "iof", rotulo: "IOF", valor: "6.38", lancamentos: 1 },
      { tipo: "anuidade", rotulo: "Anuidade", valor: "39.00", lancamentos: 1 },
      { tipo: "tarifa", rotulo: "Tarifas e pacotes", valor: "135.00", lancamentos: 3 },
    ]);
    expect(t?.descricao).toContain("R$ 180,00 de juros do rotativo e R$ 12,00 de multa");
    expect(t?.acao_sugerida).toMatch(/^Saia do rotativo/);
    // Rotativo, multa e anuidade apareceram pela primeira vez ha ate 60 dias.
    expect((t?.dados.novas as { chave: string }[]).map((n) => n.chave).sort()).toEqual([
      "ANUIDADE DIFERENCIADA",
      "JUROS ROTATIVO",
      "MULTA ATRASO FATURA",
    ]);
  });

  it("severidade e acao sem rotativo", () => {
    const multa = tarifasEJuros(
      contexto([lanc({ descricao: "Mora Boleto", valor: "3.00", data: "2026-11-01" })]),
    );
    expect(multa[0]?.acao_sugerida).toMatch(/^Programe o pagamento/);
    const caro = tarifasEJuros(
      contexto(
        serie("Tarifa Mensal", "35.00", ["2026-01-05", "2026-02-05", "2026-03-05"]),
      ),
    );
    expect(caro[0]).toMatchObject({
      severidade: "media",
      acao_sugerida: expect.stringMatching(/^Negocie/),
    });
    expect(caro[0]?.dados.novas).toEqual([]);
    const barato = tarifasEJuros(
      contexto([lanc({ descricao: "Tarifa Ted", valor: "8.50", data: "2026-01-05" })]),
    );
    expect(barato[0]?.severidade).toBe("baixa");
  });

  it("sem tarifa, nada", () => {
    expect(
      tarifasEJuros(
        contexto([lanc({ descricao: "Padaria", valor: "10.00", data: "2026-11-01" })]),
      ),
    ).toEqual([]);
  });
});

describe("ehTarifa e tipoDeTarifa", () => {
  it("categoria de sistema ou palavra na descricao", () => {
    expect(
      ehTarifa(
        lanc({
          descricao: "Qualquer",
          valor: "1",
          data: "2026-11-01",
          category_id: "Tarifas bancárias",
        }),
        CATEGORIAS,
      ),
    ).toBe(true);
    expect(
      ehTarifa(
        lanc({ descricao: "Encargos Atraso", valor: "1", data: "2026-11-01" }),
        CATEGORIAS,
      ),
    ).toBe(true);
    expect(
      ehTarifa(
        lanc({ descricao: "Multimarcas", valor: "1", data: "2026-11-01" }),
        CATEGORIAS,
      ),
    ).toBe(false);
    expect(
      tipoDeTarifa(
        lanc({
          descricao: "Cobranca",
          valor: "1",
          data: "2026-11-01",
          category_id: "Tarifas bancárias",
        }),
        CATEGORIAS,
      ),
    ).toBe("tarifa");
  });
});
