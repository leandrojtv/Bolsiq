CREATE TABLE "market_data"."fii_monthly" (
	"cnpj" text NOT NULL,
	"reference_date" date NOT NULL,
	"version" integer NOT NULL,
	"isin" text,
	"name" text NOT NULL,
	"segment" text,
	"total_assets" numeric(20, 6),
	"equity" numeric(20, 6),
	"shares_outstanding" numeric(20, 6),
	"nav_per_share" numeric(20, 6),
	"holders" integer,
	"dividend_yield_month" numeric(24, 12),
	"effective_return_month" numeric(24, 12),
	"amortization_month" numeric(24, 12),
	"dividends_payable" numeric(20, 6),
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"license" text NOT NULL,
	"source_ref" text NOT NULL,
	CONSTRAINT "fii_monthly_cnpj_reference_date_pk" PRIMARY KEY("cnpj","reference_date")
);
--> statement-breakpoint
CREATE INDEX "fii_monthly_isin_idx" ON "market_data"."fii_monthly" USING btree ("isin");