CREATE TABLE "analytics"."outbox" (
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
CREATE INDEX "outbox_pendente_idx" ON "analytics"."outbox" USING btree ("created_at") WHERE published_at IS NULL AND dead_at IS NULL;--> statement-breakpoint
CREATE INDEX "outbox_event_name_idx" ON "analytics"."outbox" USING btree ("event_name");