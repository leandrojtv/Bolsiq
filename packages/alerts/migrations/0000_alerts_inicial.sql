CREATE SCHEMA "alerts";
--> statement-breakpoint
CREATE TABLE "alerts"."alert_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tipo" text NOT NULL,
	"ticker" text,
	"params" jsonb NOT NULL,
	"canais" text[] NOT NULL,
	"cooldown_segundos" integer DEFAULT 3600 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"armado" boolean DEFAULT true NOT NULL,
	"ultimo_disparo_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts"."dead_letter" (
	"id" text PRIMARY KEY NOT NULL,
	"consumer" text NOT NULL,
	"event_id" text,
	"event_name" text,
	"subject" text NOT NULL,
	"payload" jsonb,
	"error" text NOT NULL,
	"attempts" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts"."deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"notification_id" text NOT NULL,
	"user_id" text NOT NULL,
	"canal" text NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"erro" text,
	"agendada_para" timestamp with time zone DEFAULT now() NOT NULL,
	"enviada_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "alerts"."notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"event_id" text NOT NULL,
	"titulo" text NOT NULL,
	"corpo" text NOT NULL,
	"dados" jsonb,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"lida_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "alerts"."processed_events" (
	"consumer" text NOT NULL,
	"event_id" text NOT NULL,
	"event_name" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_consumer_event_id_pk" PRIMARY KEY("consumer","event_id")
);
--> statement-breakpoint
CREATE TABLE "alerts"."push_subscriptions" (
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_user_id_endpoint_pk" PRIMARY KEY("user_id","endpoint")
);
--> statement-breakpoint
CREATE TABLE "alerts"."user_prefs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text,
	"canais_habilitados" text[] NOT NULL,
	"silencio_inicio" text,
	"silencio_fim" text,
	"fuso" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"telegram_chat_id" text,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "alert_rules_ticker_idx" ON "alerts"."alert_rules" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "alert_rules_user_idx" ON "alerts"."alert_rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "alert_rules_atualizado_idx" ON "alerts"."alert_rules" USING btree ("atualizado_em");--> statement-breakpoint
CREATE INDEX "dead_letter_consumer_idx" ON "alerts"."dead_letter" USING btree ("consumer");--> statement-breakpoint
CREATE INDEX "dead_letter_created_at_idx" ON "alerts"."dead_letter" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_notification_canal_uq" ON "alerts"."deliveries" USING btree ("notification_id","canal");--> statement-breakpoint
CREATE INDEX "deliveries_pendentes_idx" ON "alerts"."deliveries" USING btree ("status","agendada_para");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_rule_event_uq" ON "alerts"."notifications" USING btree ("rule_id","event_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "alerts"."notifications" USING btree ("user_id","criada_em");--> statement-breakpoint
CREATE INDEX "processed_events_processed_at_idx" ON "alerts"."processed_events" USING btree ("processed_at");