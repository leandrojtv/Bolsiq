CREATE TABLE "market_data"."dividends" (
	"ticker" text NOT NULL,
	"ex_date" date NOT NULL,
	"kind" text NOT NULL,
	"value_per_share" numeric(20, 6),
	"factor" numeric(20, 6),
	"ratio" text,
	"payment_date" date,
	"approved_on" date,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"license" text NOT NULL,
	"source_ref" text NOT NULL,
	CONSTRAINT "dividends_ticker_ex_date_kind_pk" PRIMARY KEY("ticker","ex_date","kind")
);
--> statement-breakpoint
CREATE TABLE "market_data"."live_quotes" (
	"ticker" text PRIMARY KEY NOT NULL,
	"price" numeric(20, 6) NOT NULL,
	"change" numeric(20, 6) NOT NULL,
	"change_percent" numeric(20, 6) NOT NULL,
	"previous_close" numeric(20, 6),
	"open" numeric(20, 6),
	"high" numeric(20, 6),
	"low" numeric(20, 6),
	"volume" bigint,
	"quoted_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"license" text NOT NULL,
	"source_ref" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_data"."share_counts" (
	"cnpj" text NOT NULL,
	"reference_date" date NOT NULL,
	"common" bigint NOT NULL,
	"preferred" bigint NOT NULL,
	"total" bigint NOT NULL,
	"treasury_total" bigint NOT NULL,
	"version" integer NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"license" text NOT NULL,
	"source_ref" text NOT NULL,
	CONSTRAINT "share_counts_cnpj_reference_date_pk" PRIMARY KEY("cnpj","reference_date")
);
