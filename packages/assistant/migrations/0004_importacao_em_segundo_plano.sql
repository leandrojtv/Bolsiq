CREATE TABLE "assistant"."import_job_files" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"user_id" text NOT NULL,
	"indice" integer NOT NULL,
	"nome" text NOT NULL,
	"mime" text NOT NULL,
	"tamanho" integer NOT NULL,
	"corretora" text,
	"dados" "bytea",
	"estado" text NOT NULL,
	"progresso" jsonb,
	"estrategia" text,
	"estimativa" jsonb,
	"resultado" jsonb,
	"erro" text,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant"."import_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"carteira_id" text NOT NULL,
	"status" text NOT NULL,
	"modelo" text,
	"aceitou_imagem" boolean DEFAULT false NOT NULL,
	"estimativa" jsonb,
	"confirmado" boolean DEFAULT false NOT NULL,
	"cancelado" boolean DEFAULT false NOT NULL,
	"erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant"."import_job_files" ADD CONSTRAINT "import_job_files_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "assistant"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_job_files_idx" ON "assistant"."import_job_files" USING btree ("job_id","indice");--> statement-breakpoint
CREATE INDEX "import_jobs_user_idx" ON "assistant"."import_jobs" USING btree ("user_id","criado_em");