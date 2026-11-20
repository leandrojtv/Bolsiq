-- RLS de recorrencias e planejamento, no padrao de 0001_rls.sql.
GRANT SELECT, INSERT, UPDATE, DELETE ON finance.recurrences, finance.budget_items TO bolsiq_app;
--> statement-breakpoint
ALTER TABLE finance.recurrences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.recurrences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recurrences_do_usuario ON finance.recurrences
  USING (user_id = finance.usuario_atual())
  WITH CHECK (user_id = finance.usuario_atual());
--> statement-breakpoint
ALTER TABLE finance.budget_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.budget_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY budget_items_do_usuario ON finance.budget_items
  USING (user_id = finance.usuario_atual())
  WITH CHECK (user_id = finance.usuario_atual());
