CREATE TABLE "assistant"."extractions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"hash" text NOT NULL,
	"versao_prompt" text NOT NULL,
	"provedor" text NOT NULL,
	"modelo" text NOT NULL,
	"nome_arquivo" text NOT NULL,
	"tipo_arquivo" text NOT NULL,
	"extraido" jsonb NOT NULL,
	"relatorio" jsonb,
	"tokens_entrada" integer NOT NULL,
	"tokens_saida" integer NOT NULL,
	"custo_estimado" numeric(14, 6),
	"original" "bytea",
	"original_mime" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmado_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assistant"."settings" ADD COLUMN "consentimento_importacao_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assistant"."settings" ADD COLUMN "guardar_original" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant"."usage" ADD COLUMN "origem" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "extractions_cache_idx" ON "assistant"."extractions" USING btree ("user_id","hash","versao_prompt","provedor","modelo");--> statement-breakpoint
CREATE INDEX "extractions_user_idx" ON "assistant"."extractions" USING btree ("user_id","criado_em");