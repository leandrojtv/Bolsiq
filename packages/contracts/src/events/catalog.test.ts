import { describe, expect, it } from "vitest";
import {
  acharEvento,
  ehNomeDeEvento,
  eventos,
  nomesDeEventos,
  STREAM_MARKETDATA,
  SUBJECT_MARKETDATA,
  streamDoEvento,
  validarPayload,
} from "./catalog.js";
import { EVENT_NAME_PATTERN, EventEnvelope } from "./envelope.js";

describe("catálogo de eventos", () => {
  it("todo nome segue <domínio>.<entidade>.<ação>.vN", () => {
    for (const nome of nomesDeEventos) {
      expect(nome, nome).toMatch(EVENT_NAME_PATTERN);
    }
  });

  it("a chave do catálogo é igual ao campo name", () => {
    for (const [chave, definicao] of Object.entries(eventos)) {
      expect(definicao.name).toBe(chave);
    }
  });

  it("todo evento declara produtor, consumidores e descrição", () => {
    for (const definicao of Object.values(eventos)) {
      expect(definicao.producer).not.toBe("");
      expect(definicao.consumers.length).toBeGreaterThan(0);
      expect(definicao.description.length).toBeGreaterThan(20);
    }
  });

  it("o exemplo de cada evento valida contra o próprio schema", () => {
    // Isto é o que mantém docs/events.md honesto: o exemplo publicado na
    // documentação é o mesmo que o schema aceita.
    for (const definicao of Object.values(eventos)) {
      const resultado = validarPayload(definicao.name, definicao.example);
      expect(resultado, `${definicao.name}: ${JSON.stringify(resultado)}`).toMatchObject({
        ok: true,
      });
    }
  });

  it("todo evento pertence a um stream conhecido", () => {
    expect(STREAM_MARKETDATA).toBe("MARKETDATA");
    expect(SUBJECT_MARKETDATA).toBe("marketdata.>");
    for (const nome of nomesDeEventos) {
      const s = streamDoEvento(nome);
      expect(s, nome).toBeDefined();
      expect(nome.startsWith(s?.subject.replace(">", "") ?? "?"), nome).toBe(true);
    }
  });

  it("dominio desconhecido nao tem stream", () => {
    expect(streamDoEvento("inventado.coisa.v1")).toBeUndefined();
  });
});

describe("validarPayload", () => {
  it("aceita payload válido", () => {
    const r = validarPayload("marketdata.quote.updated.v1", {
      ticker: "PETR4",
      price: "38.42",
      change: "-0.58",
      ts: "2026-10-31T21:05:00Z",
    });
    expect(r.ok).toBe(true);
  });

  it("recusa preço como number, mesmo em evento", () => {
    const r = validarPayload("marketdata.quote.updated.v1", {
      ticker: "PETR4",
      price: 38.42,
      change: "-0.58",
      ts: "2026-10-31T21:05:00Z",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/price/);
  });

  it("recusa campo faltando e aponta qual", () => {
    const r = validarPayload("marketdata.daily.closed.v1", { date: "2026-10-31" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/assets_updated/);
  });

  it("recusa evento desconhecido, em vez de deixar passar", () => {
    // Consumidor que recebe nome desconhecido não pode decidir se ignora
    // com segurança.
    const r = validarPayload("marketdata.inventado.v1", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/desconhecido/);
  });

  it("aceita provento com ratio e sem valor por ação", () => {
    const r = validarPayload("marketdata.dividend.announced.v1", {
      ticker: "PETR4",
      kind: "desdobramento",
      value_per_share: null,
      ratio: "1:2",
      ex_date: "2026-11-10",
      payment_date: null,
    });
    expect(r.ok).toBe(true);
  });

  it("recusa tipo de provento fora da lista", () => {
    const r = validarPayload("marketdata.dividend.announced.v1", {
      ticker: "PETR4",
      kind: "juros",
      value_per_share: "1.00",
      ratio: null,
      ex_date: "2026-11-10",
      payment_date: null,
    });
    expect(r.ok).toBe(false);
  });

  it("aponta a raiz quando o payload nem é objeto", () => {
    const r = validarPayload("marketdata.daily.closed.v1", "não é objeto");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/\(raiz\)/);
  });

  it("aceita demonstração sem ticker conhecido", () => {
    // A ligação CNPJ -> ticker é pendência conhecida; o evento não pode
    // exigir o que ainda não se sabe.
    const r = validarPayload("marketdata.statement.published.v1", {
      cvm_code: "9512",
      tickers: [],
      period_end: "2026-09-30",
      statement_kind: "ITR",
    });
    expect(r.ok).toBe(true);
  });
});

describe("ehNomeDeEvento e acharEvento", () => {
  it("reconhece nome do catálogo", () => {
    expect(ehNomeDeEvento("marketdata.quote.updated.v1")).toBe(true);
    expect(ehNomeDeEvento("marketdata.nao.existe.v1")).toBe(false);
    expect(acharEvento("marketdata.quote.updated.v1")?.producer).toBe("market-data");
    expect(acharEvento("nao.existe.v1")).toBeUndefined();
  });

  it("não confunde propriedade herdada de Object com evento", () => {
    expect(ehNomeDeEvento("toString")).toBe(false);
    expect(ehNomeDeEvento("constructor")).toBe(false);
  });
});

describe("EventEnvelope", () => {
  const envelope = {
    id: "0193a1f0-4f7c-7000-8000-000000000001",
    name: "marketdata.quote.updated.v1",
    occurred_at: "2026-10-31T21:05:00Z",
    producer: "market-data",
    payload: { ticker: "PETR4" },
  };

  it("aceita envelope completo", () => {
    expect(EventEnvelope.parse(envelope)).toMatchObject({ name: envelope.name });
  });

  it("exige id em formato uuid, que é o Nats-Msg-Id", () => {
    expect(() => EventEnvelope.parse({ ...envelope, id: "123" })).toThrow();
  });

  it("exige occurred_at com offset", () => {
    expect(() =>
      EventEnvelope.parse({ ...envelope, occurred_at: "2026-10-31T21:05:00" }),
    ).toThrow();
  });
});
