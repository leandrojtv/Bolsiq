CREATE TABLE "finance"."cards" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"nome" text NOT NULL,
	"instituicao" text,
	"final" text,
	"limite" numeric(18, 2),
	"dia_fechamento" integer NOT NULL,
	"dia_vencimento" integer NOT NULL,
	"account_id" text,
	"arquivado" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cards_user_id_uq" UNIQUE("user_id","id"),
	CONSTRAINT "cards_dia_fechamento_ck" CHECK ("finance"."cards"."dia_fechamento" between 1 and 31),
	CONSTRAINT "cards_dia_vencimento_ck" CHECK ("finance"."cards"."dia_vencimento" between 1 and 31),
	CONSTRAINT "cards_final_ck" CHECK ("finance"."cards"."final" is null or "finance"."cards"."final" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "finance"."categorization_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"padrao" text NOT NULL,
	"modo" text NOT NULL,
	"category_id" text NOT NULL,
	"prioridade" integer DEFAULT 100 NOT NULL,
	"origem" text DEFAULT 'usuario' NOT NULL,
	"vezes_aplicada" integer DEFAULT 0 NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categorization_rules_modo_ck" CHECK ("finance"."categorization_rules"."modo" in ('contem', 'comeca_com', 'regex')),
	CONSTRAINT "categorization_rules_origem_ck" CHECK ("finance"."categorization_rules"."origem" in ('usuario', 'aprendida'))
);
--> statement-breakpoint
CREATE TABLE "finance"."import_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"import_id" text NOT NULL,
	"ordem" integer NOT NULL,
	"arquivo" integer DEFAULT 0 NOT NULL,
	"fitid" text,
	"trntype" text,
	"data" date NOT NULL,
	"valor" numeric(18, 2) NOT NULL,
	"tipo" text NOT NULL,
	"descricao_original" text NOT NULL,
	"descricao_normalizada" text NOT NULL,
	"parcela_atual" integer,
	"parcela_total" integer,
	"hash_dedupe" text NOT NULL,
	"situacao" text NOT NULL,
	"duplicata_de" text,
	"categoria_detectada" text,
	"origem_categoria" text DEFAULT 'nenhuma' NOT NULL,
	"regra_id" text,
	"selecionada" boolean NOT NULL,
	"acao" text NOT NULL,
	"category_id" text,
	"categoria_editada" boolean DEFAULT false NOT NULL,
	"transferencia_conta_id" text,
	"transferencia_cartao_id" text,
	"divisoes" jsonb,
	"transaction_id" text,
	CONSTRAINT "import_rows_tipo_ck" CHECK ("finance"."import_rows"."tipo" in ('receita', 'despesa')),
	CONSTRAINT "import_rows_situacao_ck" CHECK ("finance"."import_rows"."situacao" in ('nova', 'ja_importada', 'possivel_duplicata')),
	CONSTRAINT "import_rows_acao_ck" CHECK ("finance"."import_rows"."acao" in ('importar', 'ignorar', 'conciliar')),
	CONSTRAINT "import_rows_valor_ck" CHECK ("finance"."import_rows"."valor" > 0)
);
--> statement-breakpoint
CREATE TABLE "finance"."imports" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"origem" text NOT NULL,
	"alvo" text NOT NULL,
	"account_id" text,
	"card_id" text,
	"statement_id" text,
	"arquivo_nome" text NOT NULL,
	"status" text DEFAULT 'revisao' NOT NULL,
	"banco" text,
	"conta_externa" text,
	"inicio" date,
	"fim" date,
	"saldo_informado" numeric(18, 2),
	"saldo_data" date,
	"totais" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmada_em" timestamp with time zone,
	CONSTRAINT "imports_user_id_uq" UNIQUE("user_id","id"),
	CONSTRAINT "imports_alvo_ck" CHECK ("finance"."imports"."alvo" in ('conta', 'cartao')),
	CONSTRAINT "imports_status_ck" CHECK ("finance"."imports"."status" in ('revisao', 'confirmada', 'cancelada', 'desfeita')),
	CONSTRAINT "imports_destino_ck" CHECK (("finance"."imports"."alvo" = 'conta' and "finance"."imports"."account_id" is not null and "finance"."imports"."card_id" is null and "finance"."imports"."statement_id" is null) or ("finance"."imports"."alvo" = 'cartao' and "finance"."imports"."account_id" is null and "finance"."imports"."card_id" is not null and "finance"."imports"."statement_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "finance"."statements" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"card_id" text NOT NULL,
	"vencimento" date NOT NULL,
	"fechamento" date NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statements_user_id_uq" UNIQUE("user_id","id"),
	CONSTRAINT "statements_user_card_id_uq" UNIQUE("user_id","card_id","id"),
	CONSTRAINT "statements_ciclo_ck" CHECK ("finance"."statements"."fechamento" <= "finance"."statements"."vencimento")
);
--> statement-breakpoint
ALTER TABLE "finance"."transactions" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "finance"."transactions" ADD COLUMN "card_id" text;--> statement-breakpoint
ALTER TABLE "finance"."transactions" ADD COLUMN "statement_id" text;--> statement-breakpoint
ALTER TABLE "finance"."transactions" ADD COLUMN "fitid" text;--> statement-breakpoint
ALTER TABLE "finance"."cards" ADD CONSTRAINT "cards_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "finance"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."categorization_rules" ADD CONSTRAINT "categorization_rules_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "finance"."categories"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."import_rows" ADD CONSTRAINT "import_rows_import_fk" FOREIGN KEY ("user_id","import_id") REFERENCES "finance"."imports"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."import_rows" ADD CONSTRAINT "import_rows_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "finance"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."imports" ADD CONSTRAINT "imports_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "finance"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."imports" ADD CONSTRAINT "imports_card_fk" FOREIGN KEY ("user_id","card_id") REFERENCES "finance"."cards"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."imports" ADD CONSTRAINT "imports_statement_fk" FOREIGN KEY ("user_id","card_id","statement_id") REFERENCES "finance"."statements"("user_id","card_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."statements" ADD CONSTRAINT "statements_card_fk" FOREIGN KEY ("user_id","card_id") REFERENCES "finance"."cards"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_user_idx" ON "finance"."cards" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_user_nome_uq" ON "finance"."cards" USING btree ("user_id","nome");--> statement-breakpoint
CREATE INDEX "categorization_rules_user_idx" ON "finance"."categorization_rules" USING btree ("user_id","prioridade");--> statement-breakpoint
CREATE UNIQUE INDEX "categorization_rules_user_padrao_uq" ON "finance"."categorization_rules" USING btree ("user_id","modo","padrao");--> statement-breakpoint
CREATE INDEX "import_rows_import_idx" ON "finance"."import_rows" USING btree ("import_id","ordem");--> statement-breakpoint
CREATE INDEX "imports_user_idx" ON "finance"."imports" USING btree ("user_id","criada_em");--> statement-breakpoint
CREATE UNIQUE INDEX "statements_card_vencimento_uq" ON "finance"."statements" USING btree ("user_id","card_id","vencimento");--> statement-breakpoint
ALTER TABLE "finance"."transactions" ADD CONSTRAINT "transactions_card_fk" FOREIGN KEY ("user_id","card_id") REFERENCES "finance"."cards"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."transactions" ADD CONSTRAINT "transactions_statement_fk" FOREIGN KEY ("user_id","card_id","statement_id") REFERENCES "finance"."statements"("user_id","card_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_card_data_idx" ON "finance"."transactions" USING btree ("card_id","data");--> statement-breakpoint
CREATE INDEX "transactions_statement_idx" ON "finance"."transactions" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "transactions_importacao_idx" ON "finance"."transactions" USING btree ("importacao_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_account_fitid_uq" ON "finance"."transactions" USING btree ("user_id","account_id","fitid") WHERE "finance"."transactions"."fitid" is not null and "finance"."transactions"."account_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_card_fitid_uq" ON "finance"."transactions" USING btree ("user_id","card_id","fitid") WHERE "finance"."transactions"."fitid" is not null and "finance"."transactions"."card_id" is not null;--> statement-breakpoint
ALTER TABLE "finance"."transactions" ADD CONSTRAINT "transactions_destino_ck" CHECK (("finance"."transactions"."account_id" is null) <> ("finance"."transactions"."card_id" is null) and ("finance"."transactions"."card_id" is null) = ("finance"."transactions"."statement_id" is null));