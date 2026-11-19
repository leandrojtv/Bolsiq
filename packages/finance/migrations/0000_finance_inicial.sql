CREATE SCHEMA "finance";
--> statement-breakpoint
CREATE TABLE "finance"."accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"nome" text NOT NULL,
	"tipo" text NOT NULL,
	"instituicao" text,
	"saldo_inicial" numeric(18, 2) DEFAULT '0' NOT NULL,
	"data_saldo_inicial" date NOT NULL,
	"cor" text,
	"arquivada" boolean DEFAULT false NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_user_id_uq" UNIQUE("user_id","id"),
	CONSTRAINT "accounts_tipo_ck" CHECK ("finance"."accounts"."tipo" in ('corrente', 'poupanca', 'carteira', 'beneficio', 'caixa_corretora'))
);
--> statement-breakpoint
CREATE TABLE "finance"."audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"acao" text NOT NULL,
	"recurso" text,
	"recurso_id" text,
	"detalhe" text,
	"ip" text,
	"user_agent" text,
	"ocorrido_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance"."categories" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"parent_id" text,
	"nome" text NOT NULL,
	"natureza" text NOT NULL,
	"tipo_custo" text DEFAULT 'variavel' NOT NULL,
	"essencial" boolean DEFAULT false NOT NULL,
	"cor" text,
	"icone" text,
	"sistema" boolean DEFAULT false NOT NULL,
	"arquivada" boolean DEFAULT false NOT NULL,
	CONSTRAINT "categories_user_id_uq" UNIQUE("user_id","id"),
	CONSTRAINT "categories_user_pai_nome_uq" UNIQUE NULLS NOT DISTINCT("user_id","parent_id","nome"),
	CONSTRAINT "categories_natureza_ck" CHECK ("finance"."categories"."natureza" in ('receita', 'despesa')),
	CONSTRAINT "categories_tipo_custo_ck" CHECK ("finance"."categories"."tipo_custo" in ('fixo', 'variavel'))
);
--> statement-breakpoint
CREATE TABLE "finance"."outbox" (
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
CREATE TABLE "finance"."transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"tipo" text NOT NULL,
	"valor" numeric(18, 2) NOT NULL,
	"data" date NOT NULL,
	"competencia" date NOT NULL,
	"descricao" text NOT NULL,
	"descricao_normalizada" text NOT NULL,
	"category_id" text,
	"status" text DEFAULT 'realizado' NOT NULL,
	"transferencia_par_id" text,
	"transferencia_sentido" text,
	"observacao" text,
	"importacao_id" text,
	"hash_dedupe" text,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizada_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_tipo_ck" CHECK ("finance"."transactions"."tipo" in ('receita', 'despesa', 'transferencia')),
	CONSTRAINT "transactions_status_ck" CHECK ("finance"."transactions"."status" in ('previsto', 'realizado', 'conciliado')),
	CONSTRAINT "transactions_valor_ck" CHECK ("finance"."transactions"."valor" > 0),
	CONSTRAINT "transactions_competencia_ck" CHECK ("finance"."transactions"."competencia" = date_trunc('month', "finance"."transactions"."competencia")::date),
	CONSTRAINT "transactions_transferencia_ck" CHECK (("finance"."transactions"."tipo" = 'transferencia') = ("finance"."transactions"."transferencia_sentido" is not null and "finance"."transactions"."transferencia_par_id" is not null) and ("finance"."transactions"."transferencia_sentido" is null or "finance"."transactions"."transferencia_sentido" in ('saida', 'entrada')))
);
--> statement-breakpoint
ALTER TABLE "finance"."categories" ADD CONSTRAINT "categories_parent_fk" FOREIGN KEY ("user_id","parent_id") REFERENCES "finance"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."transactions" ADD CONSTRAINT "transactions_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "finance"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."transactions" ADD CONSTRAINT "transactions_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "finance"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "finance"."accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_nome_uq" ON "finance"."accounts" USING btree ("user_id","nome");--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "finance"."audit_log" USING btree ("user_id","ocorrido_em");--> statement-breakpoint
CREATE INDEX "audit_log_acao_idx" ON "finance"."audit_log" USING btree ("acao");--> statement-breakpoint
CREATE INDEX "categories_user_idx" ON "finance"."categories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "outbox_pendente_idx" ON "finance"."outbox" USING btree ("created_at") WHERE published_at IS NULL AND dead_at IS NULL;--> statement-breakpoint
CREATE INDEX "outbox_event_name_idx" ON "finance"."outbox" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "transactions_user_data_idx" ON "finance"."transactions" USING btree ("user_id","data");--> statement-breakpoint
CREATE INDEX "transactions_account_data_idx" ON "finance"."transactions" USING btree ("account_id","data");--> statement-breakpoint
CREATE INDEX "transactions_category_idx" ON "finance"."transactions" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "transactions_user_competencia_idx" ON "finance"."transactions" USING btree ("user_id","competencia");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_user_hash_uq" ON "finance"."transactions" USING btree ("user_id","hash_dedupe") WHERE "finance"."transactions"."hash_dedupe" is not null;