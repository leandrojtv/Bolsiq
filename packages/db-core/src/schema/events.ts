import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Declarado aqui, e não importado, pelo mesmo motivo de api.ts: o drizzle-kit
// carrega os arquivos de schema em CJS e não resolve o sufixo `.js`.
const marketData = pgSchema("market_data");

const utc = (nome: string) => timestamp(nome, { withTimezone: true, mode: "string" });

/**
 * Predicado do índice parcial do outbox: só o que ainda pode ser publicado.
 *
 * `dead_at` entra no predicado porque linha morta não deve ser varrida de
 * novo. Marcar como publicada o que foi para a dead-letter seria mentir sobre
 * a entrega.
 */
const pendenteDePublicacao = sql`published_at IS NULL AND dead_at IS NULL`;

/**
 * Outbox transacional.
 *
 * A linha é gravada **na mesma transação** que grava o dado. Se a transação
 * falha, o evento não existe; se comita, o evento existe mesmo que o NATS
 * esteja fora do ar. É isso que dá at-least-once sem entrega fantasma — o
 * padrão que o CLAUDE.md exige ("publicação via outbox no Postgres").
 *
 * O `id` vai no header `Nats-Msg-Id`, e é por ele que o JetStream descarta
 * repetição dentro da janela de deduplicação.
 */
export const outbox = marketData.table(
  "outbox",
  {
    id: text("id").primaryKey(),
    eventName: text("event_name").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: utc("occurred_at").notNull(),
    producer: text("producer").notNull(),
    createdAt: utc("created_at").notNull().defaultNow(),
    /** Nulo enquanto não publicado. É o que o publisher procura. */
    publishedAt: utc("published_at"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /**
     * Preenchido quando a linha desiste: payload inválido, ou tentativas
     * esgotadas. Distinto de `published_at` de propósito.
     */
    deadAt: utc("dead_at"),
  },
  (t) => [
    // Índice parcial: o publisher varre só o que falta publicar, e o índice
    // não cresce com o histórico já publicado.
    index("outbox_pendente_idx").on(t.createdAt).where(pendenteDePublicacao),
    index("outbox_event_name_idx").on(t.eventName),
  ],
);

/**
 * Tabelas de consumidor: idempotencia e dead-letter.
 *
 * Fabrica por schema, e nao tabela fixa, porque cada servico que consome
 * eventos e dono da propria idempotencia. Com tabela fixa em `market_data`, o
 * alerts consumindo eventos gravaria no schema do market-data, e a regra de
 * propriedade de dados do CLAUDE.md cairia no primeiro consumidor novo.
 *
 * A janela de deduplicacao do JetStream e finita: passada a janela, uma
 * reentrega volta a parecer mensagem nova. `processed_events` fecha a lacuna,
 * com chave (consumer, event_id) -- uma vez por consumidor, nao no total.
 * `dead_letter` guarda o que falhou N vezes, para nao bloquear a fila.
 */
export function tabelasDeConsumidor(nomeDoSchema: string) {
  const schema = pgSchema(nomeDoSchema);

  const processedEvents = schema.table(
    "processed_events",
    {
      consumer: text("consumer").notNull(),
      eventId: text("event_id").notNull(),
      eventName: text("event_name").notNull(),
      processedAt: utc("processed_at").notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.consumer, t.eventId] }),
      index("processed_events_processed_at_idx").on(t.processedAt),
    ],
  );

  const deadLetter = schema.table(
    "dead_letter",
    {
      id: text("id").primaryKey(),
      consumer: text("consumer").notNull(),
      eventId: text("event_id"),
      eventName: text("event_name"),
      subject: text("subject").notNull(),
      payload: jsonb("payload"),
      error: text("error").notNull(),
      attempts: integer("attempts").notNull(),
      createdAt: utc("created_at").notNull().defaultNow(),
    },
    (t) => [
      index("dead_letter_consumer_idx").on(t.consumer),
      index("dead_letter_created_at_idx").on(t.createdAt),
    ],
  );

  return { processedEvents, deadLetter };
}

export type TabelasDeConsumidor = ReturnType<typeof tabelasDeConsumidor>;

const doMarketData = tabelasDeConsumidor("market_data");
export const processedEvents = doMarketData.processedEvents;
export const deadLetter = doMarketData.deadLetter;
