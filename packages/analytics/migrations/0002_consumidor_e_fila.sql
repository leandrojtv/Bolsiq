CREATE TABLE "analytics"."dead_letter" (
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
CREATE TABLE "analytics"."processed_events" (
	"consumer" text NOT NULL,
	"event_id" text NOT NULL,
	"event_name" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_consumer_event_id_pk" PRIMARY KEY("consumer","event_id")
);
--> statement-breakpoint
CREATE INDEX "dead_letter_consumer_idx" ON "analytics"."dead_letter" USING btree ("consumer");--> statement-breakpoint
CREATE INDEX "dead_letter_created_at_idx" ON "analytics"."dead_letter" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "processed_events_processed_at_idx" ON "analytics"."processed_events" USING btree ("processed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recalc_queue_ticker_pendente_uq" ON "analytics"."recalc_queue" USING btree ("ticker") WHERE processado_em IS NULL;