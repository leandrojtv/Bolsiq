-- Row Level Security do assistente: mesmas regras do portfolio (ADR 0011).
-- FORCE para o dono nao escapar, papel bolsiq_app sem BYPASSRLS, e o usuario vem
-- de set_config(..., true) dentro da transacao.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bolsiq_app') THEN
    CREATE ROLE bolsiq_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA assistant TO bolsiq_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA assistant TO bolsiq_app;
--> statement-breakpoint
-- Consumo nao se reescreve: apagar conversa nao devolve a cota. Quem apaga e a
-- exclusao de conta, pela conexao do dono (LGPD), como a auditoria do portfolio.
REVOKE UPDATE, DELETE ON assistant.usage FROM bolsiq_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assistant.usuario_atual() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('bolsiq.user_id', true), '')
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION assistant.usuario_atual() TO bolsiq_app;
--> statement-breakpoint
ALTER TABLE assistant.settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assistant.settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY settings_do_usuario ON assistant.settings
  USING (user_id = assistant.usuario_atual())
  WITH CHECK (user_id = assistant.usuario_atual());
--> statement-breakpoint
ALTER TABLE assistant.investor_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assistant.investor_profiles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY investor_profiles_do_usuario ON assistant.investor_profiles
  USING (user_id = assistant.usuario_atual())
  WITH CHECK (user_id = assistant.usuario_atual());
--> statement-breakpoint
ALTER TABLE assistant.conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assistant.conversations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY conversations_do_usuario ON assistant.conversations
  USING (user_id = assistant.usuario_atual())
  WITH CHECK (user_id = assistant.usuario_atual());
--> statement-breakpoint
ALTER TABLE assistant.messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assistant.messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY messages_do_usuario ON assistant.messages
  USING (user_id = assistant.usuario_atual())
  WITH CHECK (user_id = assistant.usuario_atual());
--> statement-breakpoint
ALTER TABLE assistant.usage ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assistant.usage FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY usage_leitura ON assistant.usage
  FOR SELECT USING (user_id = assistant.usuario_atual());
--> statement-breakpoint
CREATE POLICY usage_insercao ON assistant.usage
  FOR INSERT WITH CHECK (user_id = assistant.usuario_atual());
