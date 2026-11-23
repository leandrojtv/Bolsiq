ALTER TABLE "assistant"."import_jobs" ALTER COLUMN "carteira_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant"."import_jobs" ADD COLUMN "documento" text DEFAULT 'carteira' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant"."import_jobs" ADD CONSTRAINT "import_jobs_documento_ck" CHECK ("documento" in ('carteira', 'financas') and ("documento" = 'financas' or "carteira_id" is not null));
