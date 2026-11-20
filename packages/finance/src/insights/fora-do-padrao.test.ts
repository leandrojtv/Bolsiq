import { describe, expect, it } from "vitest";
import { contexto, lanc } from "./fabrica.js";
import { categoriasForaDoPadrao, transacoesAtipicas } from "./fora-do-padrao.js";

const ANTERIORES = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

const historico = (categoria: string, valores: string[]) =>
  ANTERIORES.map((m, i) =>
    lanc({
      category_id: categoria,
      valor: valores[i]!,
      data: `${m}-10`,
      descricao: categoria,
    }),
  );

describe("categoriasForaDoPadrao", () => {
  it("acima da mediana + 1,5 MAD e por pelo menos R$ 100", () => {
    const ls = [
      ...historico("Restaurantes e delivery", ["400", "420", "380", "410", "390", "400"]),
      lanc({
        category_id: "Restaurantes e delivery",
        valor: "500.00",
        data: "2026-11-05",
      }),
      lanc({
        category_id: "Restaurantes e delivery",
        valor: "400.00",
        data: "2026-11-12",
      }),
      // Acima do limite, mas so R$ 50 acima da mediana.
      ...historico("Mercado", ["1000", "1000", "1000", "1000", "1000", "1000"]),
      lanc({ category_id: "Mercado", valor: "1050.00", data: "2026-11-05" }),
      // R$ 120 acima da mediana, mas dentro de 1,5 MAD (MAD 100).
      ...historico("Lazer", ["300", "500", "300", "500", "400", "400"]),
      lanc({ category_id: "Lazer", valor: "520.00", data: "2026-11-05" }),
      // Sem categoria nao entra.
      lanc({ valor: "5000.00", data: "2026-11-06" }),
    ];
    const r = categoriasForaDoPadrao(contexto(ls));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      tipo: "fora_do_padrao",
      titulo: "Restaurantes e delivery acima do normal neste mês",
      impacto_mensal: "500.00",
      impacto_anual: "500.00",
      severidade: "alta",
      periodo: { inicio: "2026-11-01", fim: "2026-11-30" },
    });
    expect(r[0]?.evidencias).toHaveLength(2);
    expect(r[0]?.dados).toMatchObject({
      valor: "900.00",
      mediana: "400.00",
      mad: "10.00",
      limite: "415.00",
    });
    expect((r[0]?.dados.historico as unknown[])[0]).toEqual({
      mes: "2026-05",
      valor: "400.00",
    });
  });

  it("mes sem lancamento conta como zero; severidade pelo excesso", () => {
    const ls = [
      lanc({ category_id: "Viagem", valor: "100", data: "2026-08-10" }),
      lanc({ category_id: "Mercado", valor: "100", data: "2026-09-10" }),
      lanc({ category_id: "Mercado", valor: "100", data: "2026-10-10" }),
      lanc({ category_id: "Viagem", valor: "250.00", data: "2026-11-10" }),
      lanc({ category_id: "Mercado", valor: "150.00", data: "2026-11-10" }),
    ];
    const r = categoriasForaDoPadrao(contexto(ls));
    expect(r.map((i) => [i.dados.categoria, i.severidade])).toEqual([
      ["Viagem", "media"],
      ["Mercado", "baixa"],
    ]);
  });

  it("sem 3 meses de historico, nada", () => {
    const ls = [
      lanc({ category_id: "Lazer", valor: "100", data: "2026-09-10" }),
      lanc({ category_id: "Lazer", valor: "100", data: "2026-10-10" }),
      lanc({ category_id: "Lazer", valor: "900", data: "2026-11-10" }),
    ];
    expect(categoriasForaDoPadrao(contexto(ls))).toEqual([]);
  });
});

describe("transacoesAtipicas", () => {
  const compras = ["100.00", "110.00", "90.00"].map((valor, i) =>
    lanc({ descricao: "Posto Shell", valor, data: `2026-0${7 + i}-15` }),
  );

  it("maior que 3x a mediana do mesmo estabelecimento", () => {
    const atipica = lanc({
      descricao: "Posto Shell",
      valor: "400.00",
      data: "2026-11-10",
    });
    const normal = lanc({
      descricao: "Posto Shell",
      valor: "250.00",
      data: "2026-11-12",
    });
    const r = transacoesAtipicas(contexto([...compras, atipica, normal]));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      tipo: "transacao_atipica",
      evidencias: [atipica.id],
      impacto_mensal: "300.00",
      severidade: "media",
      dados: { mediana: "100.00", compras_anteriores: 3 },
    });
    expect(r[0]?.descricao).toContain("R$ 400,00 em 10/11/2026");
  });

  it("com menos de 3 compras antes, ou parcela, nao", () => {
    const poucas = compras.slice(1);
    expect(
      transacoesAtipicas(
        contexto([
          ...poucas,
          lanc({ descricao: "Posto Shell", valor: "900.00", data: "2026-11-10" }),
        ]),
      ),
    ).toEqual([]);
    expect(
      transacoesAtipicas(
        contexto([
          ...compras,
          lanc({
            descricao: "Posto Shell",
            valor: "900.00",
            data: "2026-11-10",
            parcelado: true,
          }),
        ]),
      ),
    ).toEqual([]);
  });
});
