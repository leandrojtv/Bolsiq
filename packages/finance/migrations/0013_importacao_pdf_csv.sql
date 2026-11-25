CREATE TABLE "finance"."csv_layouts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"assinatura" text NOT NULL,
	"mapeamento" jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance"."import_rows" ADD COLUMN "marcacao" text;--> statement-breakpoint
ALTER TABLE "finance"."import_rows" ADD COLUMN "moeda_original" text;--> statement-breakpoint
ALTER TABLE "finance"."import_rows" ADD COLUMN "valor_moeda_original" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "finance"."import_rows" ADD COLUMN "aviso" text;--> statement-breakpoint
ALTER TABLE "finance"."imports" ADD COLUMN "total_informado" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "finance"."imports" ADD COLUMN "extracao_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "csv_layouts_assinatura_uq" ON "finance"."csv_layouts" USING btree ("user_id","assinatura");--> statement-breakpoint
ALTER TABLE "finance"."import_rows" ADD CONSTRAINT "import_rows_marcacao_ck" CHECK ("finance"."import_rows"."marcacao" is null or "finance"."import_rows"."marcacao" in ('pagamento', 'estorno', 'saldo_anterior', 'iof'));--> statement-breakpoint
-- RLS do mapeamento de CSV, no padrao de 0001_rls.sql.
GRANT SELECT, INSERT, UPDATE, DELETE ON finance.csv_layouts TO bolsiq_app;
--> statement-breakpoint
ALTER TABLE finance.csv_layouts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.csv_layouts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY csv_layouts_do_usuario ON finance.csv_layouts
  USING (user_id = finance.usuario_atual())
  WITH CHECK (user_id = finance.usuario_atual());
