CREATE TABLE "finance"."dead_letter" (
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
CREATE TABLE "finance"."emitted_alerts" (
	"user_id" text NOT NULL,
	"chave" text NOT NULL,
	"event_name" text NOT NULL,
	"emitido_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emitted_alerts_user_id_chave_pk" PRIMARY KEY("user_id","chave")
);
--> statement-breakpoint
CREATE TABLE "finance"."net_worth_snapshots" (
	"user_id" text NOT NULL,
	"mes" date NOT NULL,
	"contas" numeric(18, 2) NOT NULL,
	"renda_variavel" numeric(18, 2) NOT NULL,
	"renda_fixa" numeric(18, 2) NOT NULL,
	"fundos" numeric(18, 2) NOT NULL,
	"faturas" numeric(18, 2) NOT NULL,
	"dividas" numeric(18, 2) NOT NULL,
	"patrimonio_liquido" numeric(18, 2) NOT NULL,
	"carteiras" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"carteiras_avaliadas_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "net_worth_snapshots_user_id_mes_pk" PRIMARY KEY("user_id","mes"),
	CONSTRAINT "net_worth_snapshots_mes_ck" CHECK (extract(day from "finance"."net_worth_snapshots"."mes") = 1)
);
--> statement-breakpoint
CREATE INDEX "dead_letter_created_at_idx" ON "finance"."dead_letter" USING btree ("created_at");--> statement-breakpoint
-- O outbox do finance passa a ser publicado agora (ADR 0037). O que ficou
-- parado desde o ADR 0035 e historia, nao novidade: nao vira alerta atrasado.
UPDATE "finance"."outbox" SET "published_at" = now() WHERE "published_at" IS NULL AND "dead_at" IS NULL;
