import { describe, expect, it } from "vitest";
import { essencialXSuperfluo } from "./essencial.js";
import { contexto, lanc } from "./fabrica.js";
import { CONFIGURACAO_PADRAO } from "./tipos.js";

const renda = (valor: string) => lanc({ tipo: "receita", valor, data: "2026-11-05" });

describe("essencialXSuperfluo", () => {
  it("compara com 50/30/20 e aponta o excesso dos nao essenciais", () => {
    const naoEss = lanc({ valor: "3000.00", data: "2026-11-10", category_id: "Lazer" });
    const ls = [
      renda("10000.00"),
      lanc({ valor: "4000.00", data: "2026-11-02", category_id: "Moradia" }),
      naoEss,
      lanc({ valor: "1000.00", data: "2026-11-11" }),
      lanc({
        valor: "1000.00",
        data: "2026-11-12",
        category_id: "Investimentos (aporte)",
      }),
      lanc({
        tipo: "transferencia",
        transferencia_sentido: "entrada",
        conta_tipo: "poupanca",
        valor: "500.00",
        data: "2026-11-13",
      }),
      // Nao contam: saida da transferencia, previsto, entrada em conta corrente.
      lanc({
        tipo: "transferencia",
        transferencia_sentido: "saida",
        valor: "500.00",
        data: "2026-11-13",
      }),
      lanc({
        valor: "700.00",
        data: "2026-11-28",
        category_id: "Lazer",
        status: "previsto",
      }),
      lanc({
        tipo: "transferencia",
        transferencia_sentido: "entrada",
        valor: "200.00",
        data: "2026-11-14",
      }),
    ];
    const [e, ...resto] = essencialXSuperfluo(contexto(ls));
    expect(resto).toEqual([]);
    expect(e).toMatchObject({
      tipo: "essencial_superfluo",
      titulo: "Não essenciais em 40% da renda (referência 30%)",
      impacto_mensal: "1000.00",
      impacto_anual: "12000.00",
      severidade: "alta",
      acao_sugerida:
        "Reduza R$ 1.000,00 por mês nos não essenciais para voltar a 30% da renda.",
    });
    expect(e?.dados).toMatchObject({
      valores: { essenciais: "4000.00", nao_essenciais: "4000.00", poupanca: "1500.00" },
      percentuais: { essenciais: 40, nao_essenciais: 40, poupanca: 15 },
      falta_poupar: "500.00",
    });
    expect(e?.evidencias).toContain(naoEss.id);
    expect(e?.evidencias).toHaveLength(2);
  });

  it("excesso pequeno e media; so falta poupar e baixa; dentro e info", () => {
    const pouco = essencialXSuperfluo(
      contexto([
        renda("10000.00"),
        lanc({ valor: "3500.00", data: "2026-11-10", category_id: "Lazer" }),
      ]),
    );
    expect(pouco[0]?.severidade).toBe("media");
    const semPoupar = essencialXSuperfluo(
      contexto([
        renda("10000.00"),
        lanc({ valor: "2000.00", data: "2026-11-10", category_id: "Lazer" }),
      ]),
    );
    expect(semPoupar[0]).toMatchObject({
      severidade: "baixa",
      impacto_mensal: "0.00",
      acao_sugerida: "Guarde mais R$ 2.000,00 por mês para chegar a 20% da renda.",
    });
    expect(semPoupar[0]?.titulo).toBe("Divisão da renda: 0/20/0");
    const dentro = essencialXSuperfluo(
      contexto([
        renda("10000.00"),
        lanc({
          valor: "2500.00",
          data: "2026-11-12",
          category_id: "Investimentos (aporte)",
        }),
      ]),
    );
    expect(dentro[0]).toMatchObject({
      severidade: "info",
      acao_sugerida: "Você está dentro da referência. Mantenha o ritmo.",
    });
  });

  it("referencia configuravel; sem renda, nada", () => {
    const config = {
      ...CONFIGURACAO_PADRAO,
      referencia: { essenciais: 60, nao_essenciais: 20, poupanca: 20 },
    };
    const r = essencialXSuperfluo(
      contexto(
        [
          renda("10000.00"),
          lanc({ valor: "2500.00", data: "2026-11-10", category_id: "Lazer" }),
        ],
        {
          config,
        },
      ),
    );
    expect(r[0]?.impacto_mensal).toBe("500.00");
    expect(r[0]?.descricao).toContain("A referência é 60/20/20.");
    expect(
      essencialXSuperfluo(contexto([lanc({ valor: "10", data: "2026-11-10" })])),
    ).toEqual([]);
  });
});
