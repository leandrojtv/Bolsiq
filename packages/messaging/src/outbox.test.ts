import { describe, expect, it } from "vitest";
import { envelopeDaLinha, linhaDeOutbox } from "./outbox.js";
import { MAX_ENTREGAS, streamMarketData } from "./stream.js";

const cotacao = {
  ticker: "PETR4",
  price: "38.42",
  change: "-0.58",
  ts: "2026-10-31T21:05:00Z",
};

describe("linhaDeOutbox", () => {
  it("monta a linha com id próprio e payload validado", () => {
    const linha = linhaDeOutbox({
      name: "marketdata.quote.updated.v1",
      payload: cotacao,
      producer: "market-data",
    });

    expect(linha.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(linha.eventName).toBe("marketdata.quote.updated.v1");
    expect(linha.payload).toEqual(cotacao);
    expect(linha.producer).toBe("market-data");
  });

  it("gera id diferente a cada chamada", () => {
    const a = linhaDeOutbox({
      name: "marketdata.quote.updated.v1",
      payload: cotacao,
      producer: "market-data",
    });
    const b = linhaDeOutbox({
      name: "marketdata.quote.updated.v1",
      payload: cotacao,
      producer: "market-data",
    });
    expect(a.id).not.toBe(b.id);
  });

  it("usa occurredAt informado e cai para agora quando ausente", () => {
    const comData = linhaDeOutbox({
      name: "marketdata.quote.updated.v1",
      payload: cotacao,
      producer: "market-data",
      occurredAt: "2026-10-31T21:05:00.000Z",
    });
    expect(comData.occurredAt).toBe("2026-10-31T21:05:00.000Z");

    const semData = linhaDeOutbox({
      name: "marketdata.quote.updated.v1",
      payload: cotacao,
      producer: "market-data",
    });
    expect(Date.parse(semData.occurredAt)).not.toBeNaN();
  });

  it("recusa na escrita o payload inválido, não na publicação", () => {
    // Falhar aqui dá uma pilha de chamadas apontando para quem produziu o
    // evento errado. Descobrir no publisher só diz que alguém errou.
    expect(() =>
      linhaDeOutbox({
        name: "marketdata.quote.updated.v1",
        payload: { ...cotacao, price: 38.42 },
        producer: "market-data",
      }),
    ).toThrow(/rejeitado antes do outbox/);
  });

  it("recusa evento fora do catálogo", () => {
    expect(() =>
      linhaDeOutbox({
        name: "marketdata.inventado.v1",
        payload: {},
        producer: "market-data",
      }),
    ).toThrow(/desconhecido/);
  });
});

describe("envelopeDaLinha", () => {
  it("traduz a linha do outbox no envelope publicado", () => {
    const linha = {
      id: "0193a1f0-4f7c-7000-8000-000000000001",
      eventName: "marketdata.quote.updated.v1",
      payload: cotacao,
      occurredAt: "2026-10-31T21:05:00.000Z",
      producer: "market-data",
    };

    expect(envelopeDaLinha(linha)).toEqual({
      id: linha.id,
      name: linha.eventName,
      occurred_at: linha.occurredAt,
      producer: linha.producer,
      payload: cotacao,
    });
  });
});

describe("configuração do stream", () => {
  it("usa retenção por limite, não work queue", () => {
    // Em WorkQueue o primeiro consumidor removeria a mensagem dos outros, e
    // temos vários consumidores independentes lendo os mesmos eventos.
    expect(streamMarketData.retention).toBe("limits");
    expect(streamMarketData.discard).toBe("old");
  });

  it("captura todos os eventos do domínio", () => {
    expect(streamMarketData.subjects).toEqual(["marketdata.>"]);
  });

  it("tem janela de deduplicação suficiente para o ciclo do publisher", () => {
    const duasHorasNs = 2 * 60 * 60 * 1_000_000_000;
    expect(streamMarketData.duplicate_window_ns).toBe(duasHorasNs);
    // Em nanossegundos: um valor em milissegundos aqui daria uma janela de
    // microssegundos e a deduplicação não funcionaria.
    expect(streamMarketData.duplicate_window_ns).toBeGreaterThan(1e12);
  });

  it("guarda em disco, para sobreviver a reinício do broker", () => {
    expect(streamMarketData.storage).toBe("file");
  });

  it("permite mais de uma tentativa antes da dead-letter", () => {
    expect(MAX_ENTREGAS).toBeGreaterThan(1);
  });
});
