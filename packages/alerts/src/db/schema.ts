import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { tabelasDeConsumidor } from "@bolsiq/db-core";

export const alerts = pgSchema("alerts");

const utc = (nome: string) => timestamp(nome, { withTimezone: true, mode: "string" });

/** Idempotencia e dead-letter do consumidor, no schema do proprio alerts. */
export const { processedEvents, deadLetter } = tabelasDeConsumidor("alerts");

export const alertRules = alerts.table(
  "alert_rules",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    tipo: text("tipo").notNull(),
    /** Nulo so no resumo de carteira, que nao e por ativo. */
    ticker: text("ticker"),
    params: jsonb("params").notNull(),
    canais: text("canais").array().notNull(),
    cooldown_segundos: integer("cooldown_segundos").notNull().default(3600),
    ativo: boolean("ativo").notNull().default(true),
    /**
     * Histerese: regra de cruzamento dispara e desarma, e so rearma quando a
     * condicao deixa de valer. Sem isto, cotacao oscilando em volta do limite
     * dispararia a cada tick, limitada so pelo cooldown.
     */
    armado: boolean("armado").notNull().default(true),
    ultimo_disparo_em: utc("ultimo_disparo_em"),
    criado_em: utc("criado_em").notNull().defaultNow(),
    atualizado_em: utc("atualizado_em").notNull().defaultNow(),
  },
  (t) => [
    index("alert_rules_ticker_idx").on(t.ticker),
    index("alert_rules_user_idx").on(t.user_id),
    index("alert_rules_atualizado_idx").on(t.atualizado_em),
  ],
);

export const notifications = alerts.table(
  "notifications",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    rule_id: text("rule_id").notNull(),
    /** Evento que disparou. Com rule_id, e o que impede duplicata. */
    event_id: text("event_id").notNull(),
    titulo: text("titulo").notNull(),
    corpo: text("corpo").notNull(),
    dados: jsonb("dados"),
    criada_em: utc("criada_em").notNull().defaultNow(),
    lida_em: utc("lida_em"),
  },
  (t) => [
    // Reprocessar o mesmo evento nao duplica notificacao: e a garantia
    // "reiniciar o worker nao duplica" no nivel do banco.
    uniqueIndex("notifications_rule_event_uq").on(t.rule_id, t.event_id),
    index("notifications_user_idx").on(t.user_id, t.criada_em),
  ],
);

/**
 * Entregas por canal: outbox das notificacoes.
 *
 * Criada na mesma transacao da notificacao. O envio e outro passo, que pode
 * falhar e repetir. Reiniciar o worker entre um e outro nao perde a entrega:
 * a linha continua pendente.
 */
export const deliveries = alerts.table(
  "deliveries",
  {
    id: text("id").primaryKey(),
    notification_id: text("notification_id").notNull(),
    user_id: text("user_id").notNull(),
    canal: text("canal").notNull(),
    status: text("status").notNull().default("pendente"),
    tentativas: integer("tentativas").notNull().default(0),
    erro: text("erro"),
    /** Janela de silencio: canal externo espera ate aqui. */
    agendada_para: utc("agendada_para").notNull().defaultNow(),
    enviada_em: utc("enviada_em"),
  },
  (t) => [
    uniqueIndex("deliveries_notification_canal_uq").on(t.notification_id, t.canal),
    index("deliveries_pendentes_idx").on(t.status, t.agendada_para),
  ],
);

export const userPrefs = alerts.table("user_prefs", {
  user_id: text("user_id").primaryKey(),
  email: text("email"),
  canais_habilitados: text("canais_habilitados").array().notNull(),
  /** "22:00"; nulo desliga a janela. */
  silencio_inicio: text("silencio_inicio"),
  silencio_fim: text("silencio_fim"),
  fuso: text("fuso").notNull().default("America/Sao_Paulo"),
  telegram_chat_id: text("telegram_chat_id"),
  atualizado_em: utc("atualizado_em").notNull().defaultNow(),
});

export const pushSubscriptions = alerts.table(
  "push_subscriptions",
  {
    user_id: text("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    criada_em: utc("criada_em").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.user_id, t.endpoint] })],
);
