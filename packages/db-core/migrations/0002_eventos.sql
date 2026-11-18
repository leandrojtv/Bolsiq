CREATE TABLE "market_data"."dead_letter" (
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
CREATE TABLE "market_data"."outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"event_name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"producer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"dead_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "market_data"."processed_events" (
	"consumer" text NOT NULL,
	"event_id" text NOT NULL,
	"event_name" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_consumer_event_id_pk" PRIMARY KEY("consumer","event_id")
);
--> statement-breakpoint
CREATE INDEX "dead_letter_consumer_idx" ON "market_data"."dead_letter" USING btree ("consumer");--> statement-breakpoint
CREATE INDEX "dead_letter_created_at_idx" ON "market_data"."dead_letter" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "outbox_pendente_idx" ON "market_data"."outbox" USING btree ("created_at") WHERE published_at IS NULL AND dead_at IS NULL;--> statement-breakpoint
CREATE INDEX "outbox_event_name_idx" ON "market_data"."outbox" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "processed_events_processed_at_idx" ON "market_data"."processed_events" USING btree ("processed_at");