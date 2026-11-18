import { describe, expect, it } from "vitest";
import {
  analisarComando,
  mensagemDeAssinatura,
  mensagemDeCotacao,
  mensagemDeErro,
} from "./protocolo.js";

describe("analisarComando", () => {
  it("entende subscribe e unsubscribe", () => {
    const sub = analisarComando('{"action":"subscribe","tickers":["PETR4"]}');
    expect(sub).toMatchObject({ ok: true });
    if (sub.ok) expect(sub.comando).toEqual({ action: "subscribe", tickers: ["PETR4"] });

    const unsub = analisarComando('{"action":"unsubscribe","tickers":["PETR4"]}');
    expect(unsub.ok).toBe(true);
  });

  it("entende ping", () => {
    const r = analisarComando('{"action":"ping"}');
    expect(r).toMatchObject({ ok: true });
  });

  it("recusa o que não é JSON", () => {
    const r = analisarComando("socorro");
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.erro).toMatch(/não é JSON/);
  });

  it("recusa ação desconhecida", () => {
    const r = analisarComando('{"action":"derrubar","tickers":["PETR4"]}');
    expect(r.ok).toBe(false);
  });

  it("recusa subscribe sem ticker", () => {
    const r = analisarComando('{"action":"subscribe","tickers":[]}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/tickers/);
  });

  it("recusa lote absurdo de tickers", () => {
    const tickers = Array.from({ length: 501 }, (_, i) => `T${i}`);
    const r = analisarComando(JSON.stringify({ action: "subscribe", tickers }));
    expect(r.ok).toBe(false);
  });

  it("recusa payload que não é objeto", () => {
    expect(analisarComando("42").ok).toBe(false);
    expect(analisarComando("null").ok).toBe(false);
    expect(analisarComando('"texto"').ok).toBe(false);
  });
});

describe("mensagens do servidor", () => {
  it("cotação carrega preço como string", () => {
    const m = JSON.parse(
      mensagemDeCotacao({
        ticker: "PETR4",
        price: "38.42",
        change: "-0.58",
        ts: "2026-10-31T21:05:00.000Z",
      }),
    ) as Record<string, unknown>;

    expect(m).toEqual({
      type: "quote",
      ticker: "PETR4",
      price: "38.42",
      change: "-0.58",
      ts: "2026-10-31T21:05:00.000Z",
    });
    // Regra 5: preço nunca vira number, nem no WebSocket.
    expect(typeof m.price).toBe("string");
  });

  it("erro tem tipo e mensagem", () => {
    expect(JSON.parse(mensagemDeErro("deu ruim"))).toEqual({
      type: "error",
      message: "deu ruim",
    });
  });

  it("assinatura omite rejected quando não há rejeitados", () => {
    expect(JSON.parse(mensagemDeAssinatura("subscribed", ["PETR4"]))).toEqual({
      type: "subscribed",
      tickers: ["PETR4"],
    });
  });

  it("assinatura inclui rejected quando há", () => {
    const m = JSON.parse(
      mensagemDeAssinatura(
        "subscribed",
        ["PETR4"],
        [{ ticker: "XX", motivo: "ticker inválido" }],
      ),
    ) as Record<string, unknown>;
    expect(m.rejected).toEqual([{ ticker: "XX", motivo: "ticker inválido" }]);
  });
});
