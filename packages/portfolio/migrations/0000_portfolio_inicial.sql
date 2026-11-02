CREATE SCHEMA "portfolio";
--> statement-breakpoint
CREATE TABLE "portfolio"."audit_log" (
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
CREATE TABLE "portfolio"."imports" (
	"id" text PRIMARY KEY NOT NULL,
	"portfolio_id" text NOT NULL,
	"user_id" text NOT NULL,
	"formato" text NOT NULL,
	"nome_arquivo" text,
	"linhas_lidas" integer NOT NULL,
	"linhas_aceitas" integer NOT NULL,
	"linhas_rejeitadas" integer NOT NULL,
	"rejeicoes" text,
	"duracao_ms" integer,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio"."portfolios" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"nome" text NOT NULL,
	"moeda" text DEFAULT 'BRL' NOT NULL,
	"corretora_padrao" text,
	"arquivada" boolean DEFAULT false NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio"."snapshots" (
	"portfolio_id" text NOT NULL,
	"user_id" text NOT NULL,
	"data" date NOT NULL,
	"valor_bruto" numeric(20, 6) NOT NULL,
	"custo_total" numeric(20, 6) NOT NULL,
	"resultado_nao_realizado" numeric(20, 6) NOT NULL,
	"resultado_realizado_acumulado" numeric(20, 6) NOT NULL,
	"proventos_acumulados" numeric(20, 6) NOT NULL,
	"fluxo_caixa" numeric(20, 6) DEFAULT '0' NOT NULL,
	"retorno_twr" numeric(18, 10),
	"base_100" numeric(18, 6),
	"calculado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshots_portfolio_id_data_pk" PRIMARY KEY("portfolio_id","data")
);
--> statement-breakpoint
CREATE TABLE "portfolio"."transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"portfolio_id" text NOT NULL,
	"user_id" text NOT NULL,
	"ticker" text NOT NULL,
	"tipo" text NOT NULL,
	"data" date NOT NULL,
	"quantidade" numeric(20, 8) NOT NULL,
	"preco" numeric(20, 6) NOT NULL,
	"taxas" numeric(20, 6) DEFAULT '0' NOT NULL,
	"corretora" text,
	"observacao" text,
	"origem_evento_id" text,
	"importacao_id" text,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portfolio"."transactions" ADD CONSTRAINT "transactions_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "portfolio"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "portfolio"."audit_log" USING btree ("user_id","ocorrido_em");--> statement-breakpoint
CREATE INDEX "audit_log_acao_idx" ON "portfolio"."audit_log" USING btree ("acao");--> statement-breakpoint
CREATE INDEX "imports_portfolio_idx" ON "portfolio"."imports" USING btree ("portfolio_id");--> statement-breakpoint
CREATE INDEX "portfolios_user_idx" ON "portfolio"."portfolios" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolios_user_nome_uq" ON "portfolio"."portfolios" USING btree ("user_id","nome");--> statement-breakpoint
CREATE INDEX "snapshots_data_idx" ON "portfolio"."snapshots" USING btree ("data");--> statement-breakpoint
CREATE INDEX "snapshots_user_idx" ON "portfolio"."snapshots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_portfolio_data_idx" ON "portfolio"."transactions" USING btree ("portfolio_id","data");--> statement-breakpoint
CREATE INDEX "transactions_user_idx" ON "portfolio"."transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_ticker_idx" ON "portfolio"."transactions" USING btree ("ticker");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_evento_uq" ON "portfolio"."transactions" USING btree ("portfolio_id","origem_evento_id");