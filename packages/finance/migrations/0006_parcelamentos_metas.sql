CREATE TABLE "finance"."goals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"nome" text NOT NULL,
	"valor_alvo" numeric(18, 2) NOT NULL,
	"data_alvo" date NOT NULL,
	"account_id" text,
	"portfolio_id" text,
	"valor_guardado" numeric(18, 2) DEFAULT '0' NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_valor_ck" CHECK ("finance"."goals"."valor_alvo" > 0 and "finance"."goals"."valor_guardado" >= 0)
);
--> statement-breakpoint
CREATE TABLE "finance"."installment_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"origem" text NOT NULL,
	"descricao" text NOT NULL,
	"descricao_normalizada" text NOT NULL,
	"category_id" text,
	"card_id" text,
	"account_id" text,
	"valor_total" numeric(18, 2) NOT NULL,
	"n_parcelas" integer NOT NULL,
	"sistema" text DEFAULT 'sem_juros' NOT NULL,
	"taxa_mensal" numeric(12, 8) DEFAULT '0' NOT NULL,
	"primeira_data" date NOT NULL,
	"valor_financiado" numeric(18, 2) NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installment_plans_user_id_uq" UNIQUE("user_id","id"),
	CONSTRAINT "installment_plans_origem_ck" CHECK ("finance"."installment_plans"."origem" in ('cartao', 'emprestimo', 'financiamento')),
	CONSTRAINT "installment_plans_sistema_ck" CHECK ("finance"."installment_plans"."sistema" in ('sem_juros', 'price', 'sac')),
	CONSTRAINT "installment_plans_destino_ck" CHECK (("finance"."installment_plans"."origem" = 'cartao') = ("finance"."installment_plans"."card_id" is not null) and ("finance"."installment_plans"."card_id" is null) <> ("finance"."installment_plans"."account_id" is null)),
	CONSTRAINT "installment_plans_parcelas_ck" CHECK ("finance"."installment_plans"."n_parcelas" between 1 and 600),
	CONSTRAINT "installment_plans_valor_ck" CHECK ("finance"."installment_plans"."valor_total" > 0 and "finance"."installment_plans"."valor_financiado" > 0),
	CONSTRAINT "installment_plans_taxa_ck" CHECK ("finance"."installment_plans"."taxa_mensal" >= 0)
);
--> statement-breakpoint
ALTER TABLE "finance"."transactions" ADD COLUMN "installment_plan_id" text;--> statement-breakpoint
ALTER TABLE "finance"."transactions" ADD COLUMN "parcela_numero" integer;--> statement-breakpoint
ALTER TABLE "finance"."goals" ADD CONSTRAINT "goals_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "finance"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."installment_plans" ADD CONSTRAINT "installment_plans_card_fk" FOREIGN KEY ("user_id","card_id") REFERENCES "finance"."cards"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."installment_plans" ADD CONSTRAINT "installment_plans_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "finance"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."installment_plans" ADD CONSTRAINT "installment_plans_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "finance"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goals_user_idx" ON "finance"."goals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "installment_plans_user_idx" ON "finance"."installment_plans" USING btree ("user_id","ativo");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_plano_parcela_uq" ON "finance"."transactions" USING btree ("installment_plan_id","parcela_numero") WHERE "finance"."transactions"."installment_plan_id" is not null;