CREATE TABLE "market_data"."funds" (
	"cnpj" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"class_type" text,
	"classification" text,
	"anbima_class" text,
	"status" text,
	"aum" numeric(20, 6),
	"aum_date" date,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"license" text NOT NULL,
	"source_ref" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "funds_name_idx" ON "market_data"."funds" USING btree ("name");--> statement-breakpoint
CREATE INDEX "funds_status_idx" ON "market_data"."funds" USING btree ("status");