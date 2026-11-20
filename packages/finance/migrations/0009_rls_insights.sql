-- RLS dos insights, no padrao de 0001_rls.sql.
GRANT SELECT, INSERT, UPDATE, DELETE ON finance.insights, finance.insight_feedback, finance.insight_settings TO bolsiq_app;
--> statement-breakpoint
ALTER TABLE finance.insights ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.insights FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY insights_do_usuario ON finance.insights
  USING (user_id = finance.usuario_atual())
  WITH CHECK (user_id = finance.usuario_atual());
--> statement-breakpoint
ALTER TABLE finance.insight_feedback ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.insight_feedback FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY insight_feedback_do_usuario ON finance.insight_feedback
  USING (user_id = finance.usuario_atual())
  WITH CHECK (user_id = finance.usuario_atual());
--> statement-breakpoint
ALTER TABLE finance.insight_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.insight_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY insight_settings_do_usuario ON finance.insight_settings
  USING (user_id = finance.usuario_atual())
  WITH CHECK (user_id = finance.usuario_atual());
