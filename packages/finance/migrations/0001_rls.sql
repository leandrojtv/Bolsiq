-- Row Level Security do Bolsiq Financas, no padrao do ADR 0011 (ver
-- packages/portfolio/migrations/0001_rls.sql para os tres detalhes sem os quais
-- ela nao protege nada: FORCE, papel sem BYPASSRLS e SET LOCAL).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bolsiq_app') THEN
    CREATE ROLE bolsiq_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA finance TO bolsiq_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON finance.accounts, finance.categories, finance.transactions TO bolsiq_app;
--> statement-breakpoint
-- audit_log e append-only; outbox a aplicacao so grava: quem le e marca como
-- publicado e o publicador, como dono.
GRANT SELECT, INSERT ON finance.audit_log TO bolsiq_app;
--> statement-breakpoint
GRANT INSERT ON finance.outbox TO bolsiq_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION finance.usuario_atual() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('bolsiq.user_id', true), '')
$$;
--> statement-breakpoint
ALTER TABLE finance.accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY accounts_do_usuario ON finance.accounts
  USING (user_id = finance.usuario_atual())
  WITH CHECK (user_id = finance.usuario_atual());
--> statement-breakpoint
ALTER TABLE finance.categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.categories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY categories_do_usuario ON finance.categories
  USING (user_id = finance.usuario_atual())
  WITH CHECK (user_id = finance.usuario_atual());
--> statement-breakpoint
ALTER TABLE finance.transactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.transactions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY transactions_do_usuario ON finance.transactions
  USING (user_id = finance.usuario_atual())
  WITH CHECK (user_id = finance.usuario_atual());
--> statement-breakpoint
ALTER TABLE finance.audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_log_do_usuario ON finance.audit_log
  FOR SELECT USING (user_id = finance.usuario_atual());
--> statement-breakpoint
CREATE POLICY audit_log_insercao ON finance.audit_log
  FOR INSERT WITH CHECK (user_id = finance.usuario_atual());
--> statement-breakpoint
ALTER TABLE finance.outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.outbox FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Sem politica de SELECT: a aplicacao nao le evento de ninguem.
CREATE POLICY outbox_insercao ON finance.outbox
  FOR INSERT TO bolsiq_app WITH CHECK (finance.usuario_atual() IS NOT NULL);
