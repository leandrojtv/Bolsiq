import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq, isNull } from "drizzle-orm";
import type { StartedTestContainer } from "testcontainers";
import type { Pool } from "pg";
import { deadLetter, outbox, processedEvents } from "@bolsiq/db-core";
import type { Db } from "@bolsiq/db-core";
import { conectar, type Messaging } from "../client.js";
import { assinar, type Assinatura } from "../consumer.js";
import { linhaDeOutbox } from "../outbox.js";
import { publicarPendentes } from "../publisher.js";
import {
  aplicarMigrations,
  conectarBanco,
  esperar,
  HOST_TESTE,
  PORTA_NATS,
  subirNats,
  subirPostgres,
} from "./ambiente.js";

const urlNats = `nats://${HOST_TESTE}:${PORTA_NATS}`;

let postgres: StartedTestContainer;
let nats: StartedTestContainer;
let db: Db;
let pool: Pool;
let messaging: Messaging;

function cotacao(ticker: string, preco: string) {
  return linhaDeOutbox({
    name: "marketdata.quote.updated.v1",
    payload: { ticker, price: preco, change: "0.10", ts: "2026-10-31T21:05:00Z" },
    producer: "market-data",
  });
}

beforeAll(async () => {
  const pg = await subirPostgres();
  postgres = pg.container;
  await aplicarMigrations(pg.url);
  ({ db, pool } = conectarBanco(pg.url));

  nats = await subirNats();
  messaging = await conectar({ servers: urlNats, name: "teste" });
  await messaging.garantirStream();
});

afterAll(async () => {
  await messaging.fechar().catch(() => undefined);
  await pool.end().catch(() => undefined);
  await nats.stop().catch(() => undefined);
  await postgres.stop().catch(() => undefined);
});

describe("outbox com o NATS fora do ar", () => {
  it("acumula pendentes, publica tudo na volta e não duplica no consumidor", async () => {
    const recebidos: string[] = [];
    const falhas: string[] = [];
    let assinatura: Assinatura | undefined;

    try {
      // --- 1. NATS fora do ar -------------------------------------------
      await nats.stop();

      const linhas = ["PETR4", "VALE3", "ITUB4", "BBDC4", "ABEV3"].map((t, i) =>
        cotacao(t, `${10 + i}.50`),
      );
      await db.insert(outbox).values(linhas);

      // O publisher tenta e falha: nada publicado, tentativas contadas.
      const comBrokerFora = await publicarPendentes({
        db,
        publicador: messaging,
        maxTentativas: 99,
      });
      expect(comBrokerFora.publicados).toBe(0);
      expect(comBrokerFora.falhas).toBe(5);

      const aindaPendentes = await db
        .select({ n: count() })
        .from(outbox)
        .where(and(isNull(outbox.publishedAt), isNull(outbox.deadAt)));
      expect(aindaPendentes[0]?.n).toBe(5);

      // --- 2. NATS de volta ---------------------------------------------
      nats = await subirNats();
      messaging = await conectar({ servers: urlNats, name: "teste-2" });
      await messaging.garantirStream();

      assinatura = await assinar({
        messaging,
        db,
        consumidor: "teste-entrega",
        manipular: ({ payload }) => {
          const p = payload as { ticker: string };
          recebidos.push(p.ticker);
          return Promise.resolve();
        },
        aoFalhar: (erro, ctx) => {
          falhas.push(`${erro.message} ${JSON.stringify(ctx)}`);
        },
      });

      const naVolta = await publicarPendentes({ db, publicador: messaging });
      expect(naVolta.publicados).toBe(5);
      expect(naVolta.falhas).toBe(0);

      // --- 3. Nada pendente, nada perdido -------------------------------
      const pendentesDepois = await db
        .select({ n: count() })
        .from(outbox)
        .where(and(isNull(outbox.publishedAt), isNull(outbox.deadAt)));
      expect(pendentesDepois[0]?.n).toBe(0);

      try {
        await esperar(() => Promise.resolve(recebidos.length >= 5));
      } catch (erro) {
        throw new Error(
          `recebidos=${JSON.stringify(recebidos)} falhas=${JSON.stringify(falhas)} :: ${String(erro)}`,
        );
      }

      // Rodar o publisher de novo não republica nada.
      const segundaRodada = await publicarPendentes({ db, publicador: messaging });
      expect(segundaRodada).toMatchObject({ publicados: 0, duplicados: 0, falhas: 0 });

      // Margem para uma entrega indevida aparecer, se houvesse.
      await new Promise((r) => setTimeout(r, 1500));

      expect(recebidos.sort()).toEqual(["ABEV3", "BBDC4", "ITUB4", "PETR4", "VALE3"]);
      expect(new Set(recebidos).size).toBe(recebidos.length);

      const marcas = await db
        .select({ n: count() })
        .from(processedEvents)
        .where(eq(processedEvents.consumer, "teste-entrega"));
      expect(marcas[0]?.n).toBe(5);
    } finally {
      await assinatura?.parar();
    }
  });
});

describe("idempotência no consumidor", () => {
  it("processa uma vez só quando a mesma mensagem é entregue duas vezes", async () => {
    // Mesmo envelope, dois Nats-Msg-Id diferentes: a deduplicação do JetStream
    // não pega: o que protege aqui é a tabela processed_events.
    const linha = cotacao("WEGE3", "55.00");
    const envelope = {
      id: linha.id,
      name: linha.eventName,
      occurred_at: linha.occurredAt,
      producer: linha.producer,
      payload: linha.payload,
    };

    let chamadas = 0;
    const assinatura = await assinar({
      messaging,
      db,
      consumidor: "teste-idempotencia",
      desde: "novas",
      manipular: () => {
        chamadas += 1;
        return Promise.resolve();
      },
    });

    try {
      const dados = new TextEncoder().encode(JSON.stringify(envelope));
      await messaging.js.publish(envelope.name, dados, { msgID: "primeira-vez" });
      await messaging.js.publish(envelope.name, dados, { msgID: "segunda-vez" });

      await esperar(() => Promise.resolve(chamadas >= 1));
      await new Promise((r) => setTimeout(r, 2000));

      expect(chamadas).toBe(1);

      const marcas = await db
        .select({ n: count() })
        .from(processedEvents)
        .where(eq(processedEvents.consumer, "teste-idempotencia"));
      expect(marcas[0]?.n).toBe(1);
    } finally {
      await assinatura.parar();
    }
  });

  it("a deduplicação do JetStream reconhece o mesmo Nats-Msg-Id", async () => {
    const linha = cotacao("MGLU3", "12.34");
    const envelope = {
      id: linha.id,
      name: linha.eventName,
      occurred_at: linha.occurredAt,
      producer: linha.producer,
      payload: linha.payload,
    };

    const primeiro = await messaging.publicar(envelope);
    const segundo = await messaging.publicar(envelope);

    expect(primeiro.duplicate).toBe(false);
    expect(segundo.duplicate).toBe(true);
  });
});

describe("dead-letter", () => {
  it("payload inválido vai para a dead-letter, com erro registrado, sem chamar o handler", async () => {
    let chamadas = 0;
    const errosRegistrados: string[] = [];

    const assinatura = await assinar({
      messaging,
      db,
      consumidor: "teste-dlq",
      desde: "novas",
      manipular: () => {
        chamadas += 1;
        return Promise.resolve();
      },
      aoFalhar: (erro) => {
        errosRegistrados.push(erro.message);
      },
    });

    try {
      // `price` como number: o schema exige string decimal (regra 5).
      const invalido = {
        id: "0193a1f0-4f7c-7000-8000-00000000dead",
        name: "marketdata.quote.updated.v1",
        occurred_at: "2026-10-31T21:05:00Z",
        producer: "teste",
        payload: {
          ticker: "PETR4",
          price: 38.42,
          change: "0.1",
          ts: "2026-10-31T21:05:00Z",
        },
      };

      await messaging.js.publish(
        invalido.name,
        new TextEncoder().encode(JSON.stringify(invalido)),
        { msgID: "invalido-1" },
      );

      await esperar(async () => {
        const n = await db
          .select({ n: count() })
          .from(deadLetter)
          .where(eq(deadLetter.consumer, "teste-dlq"));
        return (n[0]?.n ?? 0) > 0;
      });

      const registros = await db
        .select()
        .from(deadLetter)
        .where(eq(deadLetter.consumer, "teste-dlq"));

      expect(registros).toHaveLength(1);
      expect(registros[0]?.eventName).toBe("marketdata.quote.updated.v1");
      expect(registros[0]?.error).toMatch(/price/);
      expect(registros[0]?.subject).toBe("marketdata.quote.updated.v1");

      // O handler não é chamado: payload inválido não vira efeito.
      expect(chamadas).toBe(0);
      expect(errosRegistrados.some((m) => m.includes("price"))).toBe(true);
    } finally {
      await assinatura.parar();
    }
  });

  it("envelope ilegível vai para a dead-letter sem retry", async () => {
    const assinatura = await assinar({
      messaging,
      db,
      consumidor: "teste-dlq-ilegivel",
      desde: "novas",
      manipular: () => Promise.resolve(),
    });

    try {
      await messaging.js.publish(
        "marketdata.quote.updated.v1",
        new TextEncoder().encode("isto não é JSON"),
        { msgID: "lixo-1" },
      );

      await esperar(async () => {
        const n = await db
          .select({ n: count() })
          .from(deadLetter)
          .where(eq(deadLetter.consumer, "teste-dlq-ilegivel"));
        return (n[0]?.n ?? 0) > 0;
      });

      const registros = await db
        .select()
        .from(deadLetter)
        .where(eq(deadLetter.consumer, "teste-dlq-ilegivel"));
      expect(registros).toHaveLength(1);
      // Sem envelope legível não há id de evento a registrar.
      expect(registros[0]?.eventId).toBeNull();
    } finally {
      await assinatura.parar();
    }
  });
});

describe("publisher", () => {
  it("manda para a dead-letter o que o catálogo não valida mais", async () => {
    // Simula linha escrita por uma versão anterior do serviço, cujo schema
    // mudou: o publisher revalida antes de publicar.
    await db.insert(outbox).values({
      id: "0193a1f0-4f7c-7000-8000-0000000000bb",
      eventName: "marketdata.quote.updated.v1",
      payload: { ticker: "PETR4" },
      occurredAt: "2026-10-31T21:05:00Z",
      producer: "versao-antiga",
    });

    const r = await publicarPendentes({ db, publicador: messaging });
    expect(r.mortos).toBeGreaterThanOrEqual(1);

    const linha = await db
      .select()
      .from(outbox)
      .where(eq(outbox.id, "0193a1f0-4f7c-7000-8000-0000000000bb"));

    // dead_at, não published_at: a linha desistiu, não foi entregue.
    expect(linha[0]?.deadAt).not.toBeNull();
    expect(linha[0]?.publishedAt).toBeNull();

    const dlq = await db
      .select()
      .from(deadLetter)
      .where(eq(deadLetter.consumer, "outbox-publisher"));
    expect(dlq.length).toBeGreaterThanOrEqual(1);
  });
});
