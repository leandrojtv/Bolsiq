CREATE SCHEMA "assistant";
--> statement-breakpoint
CREATE TABLE "assistant"."conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"titulo" text NOT NULL,
	"tokens_entrada" integer DEFAULT 0 NOT NULL,
	"tokens_saida" integer DEFAULT 0 NOT NULL,
	"custo_estimado" numeric(14, 6),
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant"."investor_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"perfil" jsonb NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant"."messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"papel" text NOT NULL,
	"partes" jsonb NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant"."settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"provedor" text,
	"modelo" text,
	"chave_cifrada" text,
	"chave_final" text,
	"base_url" text,
	"preco_entrada" numeric(14, 6),
	"preco_saida" numeric(14, 6),
	"consentimento_em" timestamp with time zone,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant"."usage" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text,
	"provedor" text NOT NULL,
	"modelo" text NOT NULL,
	"plataforma" boolean DEFAULT false NOT NULL,
	"tokens_entrada" integer NOT NULL,
	"tokens_saida" integer NOT NULL,
	"custo_estimado" numeric(14, 6),
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant"."messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "assistant"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "assistant"."conversations" USING btree ("user_id","atualizada_em");--> statement-breakpoint
CREATE INDEX "messages_conversa_idx" ON "assistant"."messages" USING btree ("conversation_id","criada_em");--> statement-breakpoint
CREATE INDEX "usage_user_idx" ON "assistant"."usage" USING btree ("user_id","criado_em");