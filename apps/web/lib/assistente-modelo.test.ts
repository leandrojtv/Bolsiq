import { describe, expect, it } from "vitest";
import {
  comLinksDeTicker,
  contextoDaTela,
  filtroDaUrlDoScreener,
  linkPermitido,
  PedidoDeChat,
  SalvarConfiguracao,
  textoDoPreco,
} from "./assistente-modelo";

describe("contexto da tela", () => {
  it("le ticker, carteira, comparador e screener", () => {
    expect(contextoDaTela("/ativo/PETR4", "")).toEqual({
      rota: "/ativo/PETR4",
      ticker: "PETR4",
    });
    const id = "5f7c1f0e-6b2a-4c11-9a50-3d2e8f6a1b00";
    expect(contextoDaTela(`/carteiras/${id}`, "").carteira_id).toBe(id);
    expect(contextoDaTela("/comparar", "?t=PETR4,PRIO3&p=1A").comparando).toEqual([
      "PETR4",
      "PRIO3",
    ]);
    const s = contextoDaTela("/screener", "?preset=graham") as {
      screener: { preset: string };
    };
    expect(s.screener.preset).toBe("graham");
    expect(contextoDaTela("/alertas", "")).toEqual({ rota: "/alertas" });
  });
});

describe("links do assistente", () => {
  it("so telas do Bolsiq", () => {
    expect(linkPermitido("/ativo/PETR4")).toBe(true);
    expect(linkPermitido("/comparar?t=A,B")).toBe(true);
    expect(linkPermitido("/carteiras/x")).toBe(true);
    expect(linkPermitido("/configuracoes/perfil")).toBe(true);
    expect(linkPermitido("https://golpe.example/ativo/PETR4")).toBe(false);
    expect(linkPermitido("//golpe.example/ativo")).toBe(false);
    expect(linkPermitido("javascript:alert(1)")).toBe(false);
    expect(linkPermitido("/api/conta/excluir")).toBe(false);
    expect(linkPermitido(undefined)).toBe(false);
  });

  it("ticker no texto vira link, sem mexer no que ja e link", () => {
    expect(comLinksDeTicker("PETR4 subiu")).toBe("[PETR4](/ativo/PETR4) subiu");
    expect(comLinksDeTicker("[R$ 38,42](/ativo/PETR4)")).toBe("[R$ 38,42](/ativo/PETR4)");
    expect(comLinksDeTicker("[PETR4](/ativo/PETR4) e VALE3")).toBe(
      "[PETR4](/ativo/PETR4) e [VALE3](/ativo/VALE3)",
    );
    expect(comLinksDeTicker("HGLG11.")).toBe("[HGLG11](/ativo/HGLG11).");
  });
});

describe("formularios", () => {
  it("configuracao exige provedor conhecido e modelo", () => {
    expect(
      SalvarConfiguracao.safeParse({ provedor: "deepseek", modelo: "m" }).success,
    ).toBe(true);
    expect(SalvarConfiguracao.safeParse({ provedor: "outro", modelo: "m" }).success).toBe(
      false,
    );
    expect(
      SalvarConfiguracao.safeParse({ provedor: "deepseek", modelo: "" }).success,
    ).toBe(false);
    expect(
      SalvarConfiguracao.safeParse({ provedor: "deepseek", modelo: "m", chave: "x" })
        .success,
    ).toBe(false);
  });

  it("pergunta tem limite de tamanho", () => {
    expect(PedidoDeChat.safeParse({ texto: "oi" }).success).toBe(true);
    expect(PedidoDeChat.safeParse({ texto: " " }).success).toBe(false);
    expect(PedidoDeChat.safeParse({ texto: "x".repeat(4001) }).success).toBe(false);
    expect(PedidoDeChat.safeParse({ texto: "oi", conversa_id: "1" }).success).toBe(false);
  });

  it("filtro salvo vem do link do screener", () => {
    const f = filtroDaUrlDoScreener(
      "http://localhost:3000/screener?preset=bazin&liq=5000",
    );
    expect(f.liquidez_minima).toBe(5000);
    expect(f.ordenar_por).toBe("dy_medio_5a");
    expect(filtroDaUrlDoScreener("f=pl:0:15").faixas.pl).toEqual({ min: 0, max: 15 });
  });

  it("preco por milhao, local e desconhecido", () => {
    expect(textoDoPreco({ preco_entrada: 0.3, preco_saida: 1.2 })).toBe(
      "US$ 0.3 / 1.2 por milhão",
    );
    expect(textoDoPreco({ preco_entrada: 0, preco_saida: 0 })).toContain("local");
    expect(textoDoPreco({ preco_entrada: null, preco_saida: 1 })).toContain(
      "não informado",
    );
  });
});
