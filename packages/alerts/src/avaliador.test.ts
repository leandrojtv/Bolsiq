import { describe, expect, it } from "vitest";
import {
  avaliarCotacao,
  avaliarDemonstrativo,
  avaliarIndicadores,
  avaliarProvento,
  emCooldown,
} from "./avaliador.js";
import { Regra } from "./regras.js";

const agora = new Date("2026-11-02T15:00:00Z");

function regra(over: Record<string, unknown>): Regra {
  return Regra.parse({
    id: "r1",
    user_id: "u1",
    canais: ["inapp"],
    ticker: "PETR4",
    ...over,
  });
}

describe("emCooldown", () => {
  it("sem disparo anterior nao esta em cooldown", () => {
    expect(
      emCooldown(regra({ tipo: "preco_acima", params: { valor: "40" } }), agora),
    ).toBe(false);
  });

  it("dentro da janela esta, fora nao", () => {
    const r = regra({
      tipo: "preco_acima",
      params: { valor: "40" },
      cooldown_segundos: 600,
      ultimo_disparo_em: "2026-11-02T14:55:00Z",
    });
    expect(emCooldown(r, agora)).toBe(true);
    expect(emCooldown(r, new Date("2026-11-02T15:06:00Z"))).toBe(false);
  });
});

describe("preco_acima e preco_abaixo", () => {
  const acima = regra({ tipo: "preco_acima", params: { valor: "40.00" } });
  const abaixo = regra({ id: "r2", tipo: "preco_abaixo", params: { valor: "35.00" } });

  it("dispara ao cruzar o limite", () => {
    const r = avaliarCotacao(
      [acima, abaixo],
      { ticker: "PETR4", price: "41.00", change: "1.00" },
      agora,
    );
    expect(r.disparos.map((d) => d.regra.id)).toEqual(["r1"]);
    expect(r.disparos[0]?.titulo).toBe("PETR4 acima de R$ 40.00");
  });

  it("no limite exato nao dispara", () => {
    const r = avaliarCotacao(
      [acima],
      { ticker: "PETR4", price: "40.00", change: "0" },
      agora,
    );
    expect(r.disparos).toHaveLength(0);
  });

  it("desarmada nao dispara de novo enquanto a condicao vale", () => {
    const r = avaliarCotacao(
      [{ ...acima, armado: false }],
      { ticker: "PETR4", price: "42.00", change: "1" },
      agora,
    );
    expect(r.disparos).toHaveLength(0);
    expect(r.rearmar).toHaveLength(0);
  });

  it("rearma quando a condicao deixa de valer", () => {
    const r = avaliarCotacao(
      [{ ...acima, armado: false }],
      { ticker: "PETR4", price: "39.00", change: "-1" },
      agora,
    );
    expect(r.rearmar).toEqual(["r1"]);
  });

  it("respeita o cooldown mesmo armada", () => {
    const r = avaliarCotacao(
      [{ ...acima, ultimo_disparo_em: "2026-11-02T14:59:00Z" }],
      { ticker: "PETR4", price: "41.00", change: "1" },
      agora,
    );
    expect(r.disparos).toHaveLength(0);
  });

  it("preco_abaixo dispara abaixo do limite", () => {
    const r = avaliarCotacao(
      [abaixo],
      { ticker: "PETR4", price: "34.50", change: "-1" },
      agora,
    );
    expect(r.disparos[0]?.titulo).toBe("PETR4 abaixo de R$ 35.00");
  });
});

describe("variacao_diaria", () => {
  const r5 = regra({ tipo: "variacao_diaria", params: { percentual: 0.05 } });

  it("dispara em alta acima do percentual", () => {
    // de 40 para 42: +5%
    const r = avaliarCotacao(
      [r5],
      { ticker: "PETR4", price: "42.10", change: "2.10" },
      agora,
    );
    expect(r.disparos[0]?.titulo).toMatch(/sobe 5\.25%/);
  });

  it("dispara em queda acima do percentual", () => {
    const r = avaliarCotacao(
      [r5],
      { ticker: "PETR4", price: "37.90", change: "-2.10" },
      agora,
    );
    expect(r.disparos[0]?.titulo).toMatch(/cai/);
  });

  it("nao dispara abaixo do percentual", () => {
    const r = avaliarCotacao(
      [r5],
      { ticker: "PETR4", price: "40.50", change: "0.50" },
      agora,
    );
    expect(r.disparos).toHaveLength(0);
  });

  it("fechamento anterior nao positivo nao dispara", () => {
    const r = avaliarCotacao(
      [r5],
      { ticker: "PETR4", price: "1.00", change: "1.00" },
      agora,
    );
    expect(r.disparos).toHaveLength(0);
  });

  it("respeita cooldown", () => {
    const r = avaliarCotacao(
      [{ ...r5, ultimo_disparo_em: "2026-11-02T14:59:00Z" }],
      { ticker: "PETR4", price: "42.10", change: "2.10" },
      agora,
    );
    expect(r.disparos).toHaveLength(0);
  });
});

describe("fundamentalistas", () => {
  const ind = {
    ticker: "PETR4",
    preco_graham: "42.92",
    preco_bazin: "88.33",
    dy_12m: 0.12,
  };
  const graham = regra({ tipo: "abaixo_graham", params: {} });
  const bazin = regra({ id: "r2", tipo: "abaixo_bazin", params: {} });
  const dy = regra({ id: "r3", tipo: "dy_acima", params: { percentual: 0.1 } });

  it("abaixo de Graham e de Bazin com preco conhecido", () => {
    const r = avaliarIndicadores([graham, bazin], ind, "38.42", agora);
    expect(r.disparos.map((d) => d.regra.id)).toEqual(["r1", "r2"]);
  });

  it("preco acima do justo nao dispara", () => {
    const r = avaliarIndicadores([graham], ind, "45.00", agora);
    expect(r.disparos).toHaveLength(0);
  });

  it("sem preco conhecido, Graham e Bazin nao disparam", () => {
    const r = avaliarIndicadores([graham, bazin], ind, undefined, agora);
    expect(r.disparos).toHaveLength(0);
  });

  it("preco justo indefinido nao dispara", () => {
    const r = avaliarIndicadores(
      [graham, bazin],
      { ...ind, preco_graham: null, preco_bazin: null },
      "1",
      agora,
    );
    expect(r.disparos).toHaveLength(0);
  });

  it("DY acima independe do preco", () => {
    const r = avaliarIndicadores([dy], ind, undefined, agora);
    expect(r.disparos[0]?.titulo).toMatch(/12\.00%/);
  });

  it("DY abaixo ou nulo nao dispara", () => {
    expect(
      avaliarIndicadores([dy], { ...ind, dy_12m: 0.08 }, undefined, agora).disparos,
    ).toHaveLength(0);
    expect(
      avaliarIndicadores([dy], { ...ind, dy_12m: null }, undefined, agora).disparos,
    ).toHaveLength(0);
  });

  it("respeita cooldown", () => {
    const r = avaliarIndicadores(
      [{ ...dy, ultimo_disparo_em: "2026-11-02T14:59:00Z" }],
      ind,
      undefined,
      agora,
    );
    expect(r.disparos).toHaveLength(0);
  });
});

describe("proventos", () => {
  const anunciado = regra({ tipo: "provento_anunciado", params: {} });
  const proxima = regra({ id: "r2", tipo: "data_com_proxima", params: { dias: 5 } });
  const p = {
    ticker: "PETR4",
    kind: "dividendo",
    value_per_share: "1.25",
    ex_date: "2026-11-05",
  };

  it("anuncio dispara com o valor por acao", () => {
    const r = avaliarProvento([anunciado], p, agora);
    expect(r.disparos[0]?.corpo).toMatch(/1\.2500 por acao/);
  });

  it("anuncio sem valor dispara so com a data", () => {
    const r = avaliarProvento([anunciado], { ...p, value_per_share: null }, agora);
    expect(r.disparos[0]?.corpo).toBe("Data com 2026-11-05.");
  });

  it("data com dentro da janela dispara", () => {
    const r = avaliarProvento([proxima], p, agora);
    expect(r.disparos[0]?.titulo).toBe("Data com de PETR4 em 3 dia(s)");
  });

  it("data com distante ou passada nao dispara", () => {
    expect(
      avaliarProvento([proxima], { ...p, ex_date: "2026-12-01" }, agora).disparos,
    ).toHaveLength(0);
    expect(
      avaliarProvento([proxima], { ...p, ex_date: "2026-10-30" }, agora).disparos,
    ).toHaveLength(0);
  });

  it("respeita cooldown", () => {
    const r = avaliarProvento(
      [{ ...anunciado, ultimo_disparo_em: "2026-11-02T14:59:00Z" }],
      p,
      agora,
    );
    expect(r.disparos).toHaveLength(0);
  });
});

describe("demonstrativo", () => {
  it("dispara para o ticker informado", () => {
    const r = avaliarDemonstrativo(
      [regra({ tipo: "demonstrativo_publicado", params: {} })],
      "PETR4",
      { tickers: ["PETR3", "PETR4"], period_end: "2026-09-30", statement_kind: "ITR" },
      agora,
    );
    expect(r.disparos[0]?.titulo).toBe("PETR4 publicou ITR de 2026-09-30");
  });

  it("respeita cooldown", () => {
    const r = avaliarDemonstrativo(
      [
        regra({
          tipo: "demonstrativo_publicado",
          params: {},
          ultimo_disparo_em: "2026-11-02T14:59:00Z",
        }),
      ],
      "PETR4",
      { tickers: ["PETR4"], period_end: "2026-09-30", statement_kind: "ITR" },
      agora,
    );
    expect(r.disparos).toHaveLength(0);
  });
});
