-- RLS da importacao com IA: mesmas regras das outras tabelas do assistente (ADR 0011).
GRANT SELECT, INSERT, UPDATE, DELETE ON assistant.extractions TO bolsiq_app;
--> statement-breakpoint
ALTER TABLE assistant.extractions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assistant.extractions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY extractions_do_usuario ON assistant.extractions
  USING (user_id = assistant.usuario_atual())
  WITH CHECK (user_id = assistant.usuario_atual());
