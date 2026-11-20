CREATE TABLE "finance"."insight_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"insight_id" text NOT NULL,
	"tipo" text NOT NULL,
	"acao" text NOT NULL,
	"impacto_anual" numeric(18, 2) NOT NULL,
	"registrado_em" date NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insight_feedback_acao_ck" CHECK ("finance"."insight_feedback"."acao" in ('dispensado', 'ainda_uso', 'vou_cancelar', 'ja_cancelei'))
);
--> statement-breakpoint
CREATE TABLE "finance"."insight_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"limite_formiga" numeric(18, 2) DEFAULT '50' NOT NULL,
	"ref_essenciais" integer DEFAULT 50 NOT NULL,
	"ref_nao_essenciais" integer DEFAULT 30 NOT NULL,
	"ref_poupanca" integer DEFAULT 20 NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insight_settings_limite_ck" CHECK ("finance"."insight_settings"."limite_formiga" > 0),
	CONSTRAINT "insight_settings_referencia_ck" CHECK ("finance"."insight_settings"."ref_essenciais" + "finance"."insight_settings"."ref_nao_essenciais" + "finance"."insight_settings"."ref_poupanca" = 100)
);
--> statement-breakpoint
CREATE TABLE "finance"."insights" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"periodo" text NOT NULL,
	"calculado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"insights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assinaturas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"anunciados" text[] DEFAULT '{}'::text[] NOT NULL,
	"marca_dos_dados" text DEFAULT '' NOT NULL,
	CONSTRAINT "insights_periodo_ck" CHECK ("finance"."insights"."periodo" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "insight_feedback_user_insight_uq" ON "finance"."insight_feedback" USING btree ("user_id","insight_id");--> statement-breakpoint
CREATE UNIQUE INDEX "insights_user_periodo_uq" ON "finance"."insights" USING btree ("user_id","periodo");