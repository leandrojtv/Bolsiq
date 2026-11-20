import { describe, expect, it } from "vitest";
import { contexto, lanc, serie } from "./fabrica.js";
import { efeitoFormiga } from "./formiga.js";
import { CONFIGURACAO_PADRAO } from "./tipos.js";

const CAFES = [
  "2026-08-25",
  "2026-09-01",
  "2026-09-08",
  "2026-09-20",
  "2026-10-01",
  "2026-10-10",
  "2026-10-20",
  "2026-11-05",
  "2026-11-15",
];

const base = () => [
  ...serie("Cafe Central", "12.50", CAFES),
  ...serie("Lanchonete Boa", "20.00", ["2026-09-02", "2026-10-02", "2026-11-02"], {
    category_id: "Restaurantes e delivery",
  }),
  // Fora: so 2 vezes, acima do limite, categoria fixa, tarifa, antes da janela.
  ...serie("Padaria", "9.00", ["2026-10-03", "2026-11-03"]),
  lanc({ descricao: "Cafe Central", valor: "80.00", data: "2026-11-16" }),
  ...serie("App Fixo", "9.90", ["2026-09-04", "2026-10-04", "2026-11-04"], {
    category_id: "Assinaturas",
  }),
  ...serie("Tarifa Ted", "8.50", ["2026-09-04", "2026-10-04", "2026-11-04"]),
  lanc({ descricao: "Cafe Central", valor: "12.50", data: "2026-08-01" }),
];

describe("efeitoFormiga", () => {
  it("agrupa os habitos abaixo do limite e projeta o ano", () => {
    const ls = [
      ...base(),
      lanc({ tipo: "receita", valor: "3000.00", data: "2026-10-05" }),
    ];
    const [f, ...resto] = efeitoFormiga(contexto(ls));
    expect(resto).toEqual([]);
    expect(f).toMatchObject({
      tipo: "formiga",
      impacto_mensal: "57.50",
      impacto_anual: "690.00",
      severidade: "media",
      periodo: { inicio: "2026-08-23", fim: "2026-11-20" },
      acao_sugerida:
        "Defina um teto semanal para Cafe Central e Lanchonete Boa. Cortar metade economiza R$ 345,00 por ano.",
    });
    expect(f?.evidencias).toHaveLength(12);
    expect(f?.dados.pct_da_renda).toBe(5.8);
    expect(f?.dados.estabelecimentos).toEqual([
      {
        chave: "CAFE CENTRAL",
        nome: "Cafe Central",
        vezes: 9,
        vezes_por_mes: 3,
        valor_medio: "12.50",
        mensal: "37.50",
        anual: "450.00",
      },
      expect.objectContaining({ chave: "LANCHONETE BOA", mensal: "20.00" }),
    ]);
    expect((f?.dados.categorias as { nome: string }[]).map((c) => c.nome)).toEqual([
      "Sem categoria",
      "Restaurantes e delivery",
    ]);
  });

  it("sem renda, a severidade vem do valor", () => {
    expect(efeitoFormiga(contexto(base()))[0]?.severidade).toBe("baixa");
    const muito = serie(
      "Bar",
      "45.00",
      Array.from({ length: 21 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`),
    );
    expect(efeitoFormiga(contexto(muito))[0]?.severidade).toBe("alta");
    const medio = serie(
      "Bar",
      "45.00",
      Array.from({ length: 7 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`),
    );
    expect(efeitoFormiga(contexto(medio))[0]?.severidade).toBe("media");
  });

  it("com renda, mais de 10% dela e alta", () => {
    const ls = [
      ...base(),
      lanc({ tipo: "receita", valor: "1000.00", data: "2026-10-05" }),
    ];
    expect(efeitoFormiga(contexto(ls))[0]?.severidade).toBe("alta");
    const rico = [
      ...base(),
      lanc({ tipo: "receita", valor: "90000.00", data: "2026-10-05" }),
    ];
    expect(efeitoFormiga(contexto(rico))[0]?.severidade).toBe("baixa");
  });

  it("cobranca de assinatura nao e formiga", () => {
    const ls = base();
    const cafes = new Set(
      ls.filter((l) => l.descricao === "Cafe Central").map((l) => l.id),
    );
    const [f] = efeitoFormiga(contexto(ls), cafes);
    expect(f?.impacto_mensal).toBe("20.00");
  });

  it("limite configuravel; sem habito, nada", () => {
    const config = { ...CONFIGURACAO_PADRAO, limite_formiga: "10.00" };
    expect(efeitoFormiga(contexto(base(), { config }))).toEqual([]);
    expect(efeitoFormiga(contexto([]))).toEqual([]);
  });
});
