import { describe, expect, it } from "vitest";
import { CARTEIRA_ID, fontesDeTeste, HOJE } from "../eval/base.js";
import { criarFerramentas, NOMES_DAS_FERRAMENTAS, resumirSerie } from "./ferramentas.js";

type Saida = Record<string, unknown> & { proveniencia?: unknown[] };

function chamar(
  ferramentas: ReturnType<typeof criarFerramentas>,
  nome: string,
  entrada: unknown,
) {
  const t = ferramentas[nome] as unknown as {
    inputSchema: { parse: (v: unknown) => unknown };
    execute: (e: unknown, o: unknown) => Promise<Saida>;
  };
  return t.execute(t.inputSchema.parse(entrada), {});
}

const opcoes = { hoje: HOJE, modo: "personal" as const };

describe("ferramentas", () => {
  const f = criarFerramentas(fontesDeTeste(), opcoes);

  it("existem todas, com schema", () => {
    expect(Object.keys(f).sort()).toEqual([...NOMES_DAS_FERRAMENTAS].sort());
  });

  it.each([
    ["cotacao", { tickers: ["petr4"] }],
    ["historico", { ticker: "VALE3", periodo: "1M" }],
    ["proventos", { ticker: "VALE3" }],
    ["fundamentos", { ticker: "PETR4" }],
    ["indicadores", { tickers: ["PETR4"] }],
    ["comparar", { tickers: ["PETR4", "PRIO3"] }],
    ["screener", { preset: "graham" }],
    ["cenario_macro", {}],
    ["minha_carteira", {}],
    ["avaliar_carteira", {}],
    ["sugerir_aporte", { valor: 1000 }],
  ])("%s devolve dado com proveniencia (fonte e data)", async (nome, entrada) => {
    const s = await chamar(f, nome, entrada);
    expect(s.erro).toBeUndefined();
    expect(s.proveniencia?.length).toBeGreaterThan(0);
    for (const p of s.proveniencia as { fonte: string; data: string }[]) {
      expect(p.fonte).toBeTruthy();
      expect(p.data).toBeTruthy();
    }
  });

  it("minha_carteira nao manda a serie do grafico", async () => {
    const s = await chamar(f, "minha_carteira", {});
    expect(s.serie).toBeUndefined();
    expect(s.link).toBe(`/carteiras/${CARTEIRA_ID}`);
  });

  it("carteira de outro usuario some, como inexistente", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    for (const n of ["minha_carteira", "avaliar_carteira"]) {
      expect((await chamar(f, n, { id })).erro).toBe("carteira_nao_encontrada");
    }
    expect((await chamar(f, "sugerir_aporte", { id, valor: 10 })).erro).toBe(
      "carteira_nao_encontrada",
    );
  });

  it("sem perfil, avaliar e sugerir pedem o perfil", async () => {
    const g = criarFerramentas(fontesDeTeste({ semPerfil: true }), opcoes);
    for (const [n, e] of [
      ["avaliar_carteira", {}],
      ["sugerir_aporte", { valor: 1 }],
    ] as const) {
      const s = await chamar(g, n, e);
      expect(s.erro).toBe("perfil_ausente");
      expect(s.link).toBe("/configuracoes/perfil");
    }
  });

  it("fonte fora vira 'indisponivel', sem detalhe da excecao", async () => {
    const s = await chamar(f, "cotacao", { tickers: ["ZZZZ3"] });
    expect(s).toEqual({ erro: "indisponivel", mensagem: "A fonte não respondeu agora." });
  });

  it("ativo sem indicador e dito, nao zerado", async () => {
    const s = await chamar(f, "indicadores", { tickers: ["ZZZZ3"] });
    expect(s.ativos).toEqual([{ ticker: "ZZZZ3", erro: "sem_indicadores" }]);
  });

  it("screener recusa indicador que nao existe", async () => {
    const s = await chamar(f, "screener", { faixas: { nao_existe: { min: 1 } } });
    expect(s.erro).toBe("filtro_invalido");
  });

  it("criar_alerta so propoe, nao grava", async () => {
    let chamadas = 0;
    const espia = new Proxy(fontesDeTeste(), {
      get(alvo, k) {
        chamadas++;
        return Reflect.get(alvo, k) as unknown;
      },
    });
    const s = await chamar(criarFerramentas(espia, opcoes), "criar_alerta", {
      ticker: "PETR4",
      tipo: "preco_acima",
      valor: 40,
    });
    expect(s.pendente_de_confirmacao).toBe(true);
    expect(s.proposta).toEqual({ ticker: "PETR4", tipo: "preco_acima", valor: 40 });
    expect(chamadas).toBe(0);
  });

  it("carteira da tela vale quando o modelo nao informa id", async () => {
    const pedidos: (string | undefined)[] = [];
    const base = fontesDeTeste();
    const g = criarFerramentas(
      {
        ...base,
        carteira: (id) => {
          pedidos.push(id);
          return base.carteira(id);
        },
      },
      { ...opcoes, carteiraDaTela: CARTEIRA_ID },
    );
    await chamar(g, "minha_carteira", {});
    expect(pedidos).toEqual([CARTEIRA_ID]);
  });

  it("serie longa vai resumida, com o ultimo ponto", () => {
    const r = resumirSerie(
      Array.from({ length: 500 }, (_, i) => i),
      60,
    );
    expect(r).toHaveLength(60);
    expect(r[0]).toBe(0);
    expect(r.at(-1)).toBe(499);
    expect(resumirSerie([1, 2])).toEqual([1, 2]);
  });
});
