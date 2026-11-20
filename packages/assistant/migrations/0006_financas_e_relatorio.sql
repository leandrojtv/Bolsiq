ALTER TABLE "assistant"."conversations" ADD COLUMN "modulo" text DEFAULT 'investimentos' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant"."settings" ADD COLUMN "consentimento_financas_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assistant"."settings" ADD COLUMN "relatorio_mensal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant"."settings" ADD COLUMN "relatorio_ultimo_mes" text;