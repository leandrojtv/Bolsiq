-- RLS das tabelas da importacao e do cartao, no padrao de 0001_rls.sql.
GRANT SELECT, INSERT, UPDATE, DELETE ON finance.cards, finance.statements, finance.imports, finance.import_rows, finance.categorization_rules TO bolsiq_app;
--> statement-breakpoint
ALTER TABLE finance.cards ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.cards FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY cards_do_usuario ON finance.cards
  USING (user_id = finance.usuario_atual())
  WITH CHECK (user_id = finance.usuario_atual());
--> statement-breakpoint
ALTER TABLE finance.statements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.statements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY statements_do_usuario ON finance.statements
  USING (user_id = finance.usuario_atual())
  WITH CHECK (user_id = finance.usuario_atual());
--> statement-breakpoint
ALTER TABLE finance.imports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.imports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY imports_do_usuario ON finance.imports
  USING (user_id = finance.usuario_atual())
  WITH CHECK (user_id = finance.usuario_atual());
--> statement-breakpoint
ALTER TABLE finance.import_rows ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.import_rows FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY import_rows_do_usuario ON finance.import_rows
  USING (user_id = finance.usuario_atual())
  WITH CHECK (user_id = finance.usuario_atual());
--> statement-breakpoint
ALTER TABLE finance.categorization_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.categorization_rules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY categorization_rules_do_usuario ON finance.categorization_rules
  USING (user_id = finance.usuario_atual())
  WITH CHECK (user_id = finance.usuario_atual());
