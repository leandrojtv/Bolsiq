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
 * Idempotência no consumidor.
 *
 * A janela de deduplicação do JetStream é finita. Passada a janela, uma
 * reentrega volta a parecer mensagem nova — e reentrega acontece sempre que um
 * consumidor processa e morre antes do ack. Esta tabela é o que fecha a lacuna.
 *
 * A chave é (consumer, event_id): o mesmo evento precisa ser processado uma vez
 * por cada consumidor, não uma vez no total.
 */
export const processedEvents = marketData.table(
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

/**
 * Dead-letter.
 *
 * Mensagem que falhou N vezes para. Insistir indefinidamente em payload
 * inválido ou bug de consumidor não conserta nada e bloqueia a fila atrás dela.
 */
export const deadLetter = marketData.table(
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
