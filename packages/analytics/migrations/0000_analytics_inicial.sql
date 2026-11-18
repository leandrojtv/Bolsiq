CREATE SCHEMA "analytics";
--> statement-breakpoint
CREATE TABLE "analytics"."assets_mirror" (
	"ticker" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"sector" text,
	"cvm_code" text,
	"listed" text DEFAULT 'true' NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics"."daily_returns" (
	"ticker" text NOT NULL,
	"date" date NOT NULL,
	"retorno" numeric(18, 6) NOT NULL,
	"base_100" numeric(18, 6),
	"volume_financeiro" numeric(20, 6),
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_returns_ticker_date_pk" PRIMARY KEY("ticker","date")
);
--> statement-breakpoint
CREATE TABLE "analytics"."indicators" (
	"ticker" text NOT NULL,
	"reference_date" date NOT NULL,
	"kind" text NOT NULL,
	"lpa" numeric(20, 6),
	"vpa" numeric(20, 6),
	"ebitda" numeric(20, 6),
	"divida_liquida" numeric(20, 6),
	"pl" numeric(18, 6),
	"pvp" numeric(18, 6),
	"ev_ebitda" numeric(18, 6),
	"ev_ebit" numeric(18, 6),
	"p_receita" numeric(18, 6),
	"dy_12m" numeric(18, 6),
	"dy_medio_5a" numeric(18, 6),
	"roe" numeric(18, 6),
	"roic" numeric(18, 6),
	"roa" numeric(18, 6),
	"margem_bruta" numeric(18, 6),
	"margem_ebitda" numeric(18, 6),
	"margem_liquida" numeric(18, 6),
	"dl_ebitda" numeric(18, 6),
	"dl_pl" numeric(18, 6),
	"liquidez_corrente" numeric(18, 6),
	"cagr_receita_5a" numeric(18, 6),
	"cagr_lucro_5a" numeric(18, 6),
	"preco_graham" numeric(20, 6),
	"margem_graham" numeric(18, 6),
	"preco_bazin" numeric(20, 6),
	"margem_bazin" numeric(18, 6),
	"retorno_periodo" numeric(18, 6),
	"volatilidade_anual" numeric(18, 6),
	"drawdown_maximo" numeric(18, 6),
	"sharpe" numeric(18, 6),
	"beta" numeric(18, 6),
	"liquidez_diaria" numeric(20, 6),
	"vacancia" numeric(18, 6),
	"patrimonio_liquido" numeric(20, 6),
	"cotistas" integer,
	"fonte_demonstrativo" text,
	"calculado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indicators_ticker_reference_date_pk" PRIMARY KEY("ticker","reference_date")
);
--> statement-breakpoint
CREATE TABLE "analytics"."recalc_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"ticker" text,
	"motivo" text NOT NULL,
	"event_id" text,
	"enfileirado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"processado_em" timestamp with time zone,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"bytes_lidos" bigint
);
--> statement-breakpoint
CREATE INDEX "assets_mirror_kind_sector_idx" ON "analytics"."assets_mirror" USING btree ("kind","sector");--> statement-breakpoint
CREATE INDEX "daily_returns_date_idx" ON "analytics"."daily_returns" USING btree ("date");--> statement-breakpoint
CREATE INDEX "indicators_reference_date_idx" ON "analytics"."indicators" USING btree ("reference_date");--> statement-breakpoint
CREATE INDEX "indicators_kind_idx" ON "analytics"."indicators" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "indicators_pl_idx" ON "analytics"."indicators" USING btree ("pl");--> statement-breakpoint
CREATE INDEX "indicators_pvp_idx" ON "analytics"."indicators" USING btree ("pvp");--> statement-breakpoint
CREATE INDEX "indicators_roe_idx" ON "analytics"."indicators" USING btree ("roe");--> statement-breakpoint
CREATE INDEX "indicators_dy_medio_idx" ON "analytics"."indicators" USING btree ("dy_medio_5a");--> statement-breakpoint
CREATE INDEX "indicators_ev_ebit_idx" ON "analytics"."indicators" USING btree ("ev_ebit");--> statement-breakpoint
CREATE INDEX "indicators_liquidez_idx" ON "analytics"."indicators" USING btree ("liquidez_diaria");--> statement-breakpoint
CREATE INDEX "recalc_queue_pendente_idx" ON "analytics"."recalc_queue" USING btree ("enfileirado_em");