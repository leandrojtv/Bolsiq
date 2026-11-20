CREATE TABLE "finance"."budget_items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"competencia" date NOT NULL,
	"category_id" text NOT NULL,
	"descricao" text,
	"valor" numeric(18, 2) NOT NULL,
	"fixo" boolean DEFAULT false NOT NULL,
	"recurrence_id" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_items_mes_item_uq" UNIQUE NULLS NOT DISTINCT("user_id","competencia","category_id","descricao"),
	CONSTRAINT "budget_items_valor_ck" CHECK ("finance"."budget_items"."valor" >= 0),
	CONSTRAINT "budget_items_competencia_ck" CHECK ("finance"."budget_items"."competencia" = date_trunc('month', "finance"."budget_items"."competencia")::date)
);
--> statement-breakpoint
CREATE TABLE "finance"."recurrences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tipo" text NOT NULL,
	"descricao" text NOT NULL,
	"valor" numeric(18, 2) NOT NULL,
	"category_id" text,
	"account_id" text,
	"card_id" text,
	"frequencia" text NOT NULL,
	"dia" integer NOT NULL,
	"inicio" date NOT NULL,
	"fim" date,
	"valor_variavel" boolean DEFAULT false NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurrences_user_id_uq" UNIQUE("user_id","id"),
	CONSTRAINT "recurrences_tipo_ck" CHECK ("finance"."recurrences"."tipo" in ('receita', 'despesa')),
	CONSTRAINT "recurrences_frequencia_ck" CHECK ("finance"."recurrences"."frequencia" in ('mensal', 'semanal', 'anual')),
	CONSTRAINT "recurrences_dia_ck" CHECK ("finance"."recurrences"."dia" between 1 and (case when "finance"."recurrences"."frequencia" = 'semanal' then 7 else 31 end)),
	CONSTRAINT "recurrences_valor_ck" CHECK ("finance"."recurrences"."valor" > 0),
	CONSTRAINT "recurrences_destino_ck" CHECK (("finance"."recurrences"."account_id" is null) <> ("finance"."recurrences"."card_id" is null)),
	CONSTRAINT "recurrences_periodo_ck" CHECK ("finance"."recurrences"."fim" is null or "finance"."recurrences"."fim" >= "finance"."recurrences"."inicio")
);
--> statement-breakpoint
ALTER TABLE "finance"."cards" ADD COLUMN "bandeira" text;--> statement-breakpoint
ALTER TABLE "finance"."cards" ADD COLUMN "cor" text;--> statement-breakpoint
-- Faturas que ja existem: competencia sai do vencimento, antes do NOT NULL.
ALTER TABLE "finance"."statements" ADD COLUMN "competencia" date;--> statement-breakpoint
UPDATE "finance"."statements" SET "competencia" = date_trunc('month', "vencimento")::date;--> statement-breakpoint
ALTER TABLE "finance"."statements" ALTER COLUMN "competencia" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "finance"."statements" ADD COLUMN "status" text DEFAULT 'aberta' NOT NULL;--> statement-breakpoint
ALTER TABLE "finance"."statements" ADD COLUMN "total_informado" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "finance"."statements" ADD COLUMN "pagamento_id" text;--> statement-breakpoint
ALTER TABLE "finance"."transactions" ADD COLUMN "recurrence_id" text;--> statement-breakpoint
ALTER TABLE "finance"."budget_items" ADD CONSTRAINT "budget_items_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "finance"."categories"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."recurrences" ADD CONSTRAINT "recurrences_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "finance"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."recurrences" ADD CONSTRAINT "recurrences_card_fk" FOREIGN KEY ("user_id","card_id") REFERENCES "finance"."cards"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."recurrences" ADD CONSTRAINT "recurrences_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "finance"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_items_user_mes_idx" ON "finance"."budget_items" USING btree ("user_id","competencia");--> statement-breakpoint
CREATE INDEX "recurrences_user_idx" ON "finance"."recurrences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_recorrencia_data_uq" ON "finance"."transactions" USING btree ("recurrence_id","data") WHERE "finance"."transactions"."recurrence_id" is not null;--> statement-breakpoint
ALTER TABLE "finance"."statements" ADD CONSTRAINT "statements_status_ck" CHECK ("finance"."statements"."status" in ('aberta', 'fechada', 'paga'));