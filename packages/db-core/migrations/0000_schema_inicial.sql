CREATE SCHEMA "market_data";
--> statement-breakpoint
CREATE TABLE "market_data"."assets" (
	"id" text PRIMARY KEY NOT NULL,
	"ticker" text,
	"isin" text,
	"cnpj" text,
	"cvm_code" text,
	"name" text NOT NULL,
	"legal_name" text,
	"kind" text NOT NULL,
	"sector" text,
	"status" text,
	"ownership_type" text,
	"registered_at" date,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"license" text NOT NULL,
	"source_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_data"."fetch_log" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"content_hash" text NOT NULL,
	"bytes" bigint,
	"status" text NOT NULL,
	"error_message" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"rows_written" integer,
	"fetched_at" timestamp with time zone NOT NULL,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "market_data"."financial_statements" (
	"cvm_code" text NOT NULL,
	"cnpj" text NOT NULL,
	"reference_date" date NOT NULL,
	"period_start" date,
	"period_end" date,
	"statement_type" text NOT NULL,
	"is_consolidated" boolean NOT NULL,
	"account_code" text NOT NULL,
	"account_label" text NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"currency" text NOT NULL,
	"version" integer NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"license" text NOT NULL,
	"source_ref" text NOT NULL,
	CONSTRAINT "financial_statements_cvm_code_reference_date_statement_type_is_consolidated_account_code_pk" PRIMARY KEY("cvm_code","reference_date","statement_type","is_consolidated","account_code")
);
--> statement-breakpoint
CREATE TABLE "market_data"."fund_daily" (
	"cnpj_fundo" text NOT NULL,
	"date" date NOT NULL,
	"nav" numeric(20, 6) NOT NULL,
	"aum" numeric(20, 6) NOT NULL,
	"inflows" numeric(20, 6),
	"outflows" numeric(20, 6),
	"holders" integer,
	"total_portfolio" numeric(20, 6),
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"license" text NOT NULL,
	"source_ref" text NOT NULL,
	CONSTRAINT "fund_daily_cnpj_fundo_date_pk" PRIMARY KEY("cnpj_fundo","date")
);
--> statement-breakpoint
CREATE TABLE "market_data"."macro_series" (
	"series_code" text NOT NULL,
	"date" date NOT NULL,
	"value" numeric(20, 6) NOT NULL,
	"unit" text NOT NULL,
	"frequency" text NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"license" text NOT NULL,
	"source_ref" text NOT NULL,
	CONSTRAINT "macro_series_series_code_date_pk" PRIMARY KEY("series_code","date")
);
--> statement-breakpoint
CREATE TABLE "market_data"."quotes_daily" (
	"ticker" text NOT NULL,
	"date" date NOT NULL,
	"open" numeric(20, 6) NOT NULL,
	"high" numeric(20, 6) NOT NULL,
	"low" numeric(20, 6) NOT NULL,
	"close" numeric(20, 6) NOT NULL,
	"average" numeric(20, 6),
	"adj_close" numeric(20, 6),
	"volume" bigint NOT NULL,
	"trades" integer NOT NULL,
	"financial_volume" numeric(20, 6) NOT NULL,
	"quote_factor" integer DEFAULT 1 NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"license" text NOT NULL,
	"source_ref" text NOT NULL,
	CONSTRAINT "quotes_daily_ticker_date_pk" PRIMARY KEY("ticker","date")
);
--> statement-breakpoint
CREATE TABLE "market_data"."api_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_data"."api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "market_data"."api_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"requests_per_minute" integer NOT NULL,
	"requests_per_month" bigint NOT NULL,
	"tickers_per_call" integer NOT NULL,
	"allowed_endpoints" text[] NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_data"."api_usage" (
	"key_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"route" text NOT NULL,
	"method" text NOT NULL,
	"status" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"correlation_id" text,
	CONSTRAINT "api_usage_key_id_ts_route_pk" PRIMARY KEY("key_id","ts","route")
);
--> statement-breakpoint
ALTER TABLE "market_data"."api_clients" ADD CONSTRAINT "api_clients_plan_id_api_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "market_data"."api_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_data"."api_keys" ADD CONSTRAINT "api_keys_client_id_api_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "market_data"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_ticker_uq" ON "market_data"."assets" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "assets_cnpj_idx" ON "market_data"."assets" USING btree ("cnpj");--> statement-breakpoint
CREATE INDEX "assets_cvm_code_idx" ON "market_data"."assets" USING btree ("cvm_code");--> statement-breakpoint
CREATE INDEX "assets_kind_idx" ON "market_data"."assets" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "fetch_log_source_ref_uq" ON "market_data"."fetch_log" USING btree ("source","source_ref","content_hash");--> statement-breakpoint
CREATE INDEX "fetch_log_source_fetched_at_idx" ON "market_data"."fetch_log" USING btree ("source","fetched_at");--> statement-breakpoint
CREATE INDEX "fetch_log_status_idx" ON "market_data"."fetch_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "financial_statements_cnpj_idx" ON "market_data"."financial_statements" USING btree ("cnpj");--> statement-breakpoint
CREATE INDEX "financial_statements_reference_date_idx" ON "market_data"."financial_statements" USING btree ("reference_date");--> statement-breakpoint
CREATE INDEX "fund_daily_date_idx" ON "market_data"."fund_daily" USING btree ("date");--> statement-breakpoint
CREATE INDEX "macro_series_date_idx" ON "market_data"."macro_series" USING btree ("date");--> statement-breakpoint
CREATE INDEX "quotes_daily_date_idx" ON "market_data"."quotes_daily" USING btree ("date");--> statement-breakpoint
CREATE INDEX "api_clients_plan_idx" ON "market_data"."api_clients" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "market_data"."api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_prefix_idx" ON "market_data"."api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "api_keys_client_idx" ON "market_data"."api_keys" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "api_keys_status_idx" ON "market_data"."api_keys" USING btree ("status");--> statement-breakpoint
CREATE INDEX "api_usage_ts_idx" ON "market_data"."api_usage" USING btree ("ts");