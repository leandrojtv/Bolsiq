CREATE TABLE "portfolio"."cargas_de_posicao" (
	"portfolio_id" text NOT NULL,
	"user_id" text NOT NULL,
	"corretora" text NOT NULL,
	"data_posicao" date NOT NULL,
	"importacao_id" text NOT NULL,
	CONSTRAINT "cargas_de_posicao_portfolio_id_corretora_pk" PRIMARY KEY("portfolio_id","corretora")
);
--> statement-breakpoint
CREATE TABLE "portfolio"."posicoes" (
	"id" text PRIMARY KEY NOT NULL,
	"portfolio_id" text NOT NULL,
	"user_id" text NOT NULL,
	"importacao_id" text NOT NULL,
	"corretora" text NOT NULL,
	"data_posicao" date NOT NULL,
	"chave_ativo" text NOT NULL,
	"classe" text NOT NULL,
	"subclasse" text,
	"ativo" text NOT NULL,
	"codigo" text,
	"cnpj" text,
	"emissor" text,
	"indexador" text,
	"pct_indexador" numeric(12, 8),
	"taxa_aa" numeric(12, 8),
	"data_aplicacao" date,
	"vencimento" date,
	"liquidez_diaria" boolean,
	"quantidade" numeric(20, 8),
	"preco_unitario" numeric(20, 6),
	"preco_medio" numeric(20, 6),
	"valor_aplicado" numeric(20, 6),
	"saldo_bruto" numeric(20, 6) NOT NULL,
	"ir" numeric(20, 6),
	"iof" numeric(20, 6),
	"saldo_liquido" numeric(20, 6),
	"valorizacao" text NOT NULL,
	"observacao" text,
	"vigente" boolean DEFAULT true NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portfolio"."cargas_de_posicao" ADD CONSTRAINT "cargas_de_posicao_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "portfolio"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio"."posicoes" ADD CONSTRAINT "posicoes_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "portfolio"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cargas_de_posicao_user_idx" ON "portfolio"."cargas_de_posicao" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "posicoes_user_idx" ON "portfolio"."posicoes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "posicoes_importacao_idx" ON "portfolio"."posicoes" USING btree ("importacao_id");--> statement-breakpoint
CREATE UNIQUE INDEX "posicoes_vigente_uq" ON "portfolio"."posicoes" USING btree ("portfolio_id","corretora","chave_ativo") WHERE "portfolio"."posicoes"."vigente";--> statement-breakpoint
-- O GRANT de 0001 so alcancou as tabelas que existiam na epoca.
GRANT SELECT, INSERT, UPDATE, DELETE ON portfolio.posicoes, portfolio.cargas_de_posicao TO bolsiq_app;
--> statement-breakpoint
ALTER TABLE portfolio.posicoes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portfolio.posicoes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY posicoes_do_usuario ON portfolio.posicoes
  USING (user_id = portfolio.usuario_atual())
  WITH CHECK (user_id = portfolio.usuario_atual());
--> statement-breakpoint
ALTER TABLE portfolio.cargas_de_posicao ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portfolio.cargas_de_posicao FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY cargas_de_posicao_do_usuario ON portfolio.cargas_de_posicao
  USING (user_id = portfolio.usuario_atual())
  WITH CHECK (user_id = portfolio.usuario_atual());
