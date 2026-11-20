-- RLS de planos de parcelamento e metas, no padrao de 0001_rls.sql.
GRANT SELECT, INSERT, UPDATE, DELETE ON finance.installment_plans, finance.goals TO bolsiq_app;
--> statement-breakpoint
ALTER TABLE finance.installment_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.installment_plans FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY installment_plans_do_usuario ON finance.installment_plans
  USING (user_id = finance.usuario_atual())
  WITH CHECK (user_id = finance.usuario_atual());
--> statement-breakpoint
ALTER TABLE finance.goals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.goals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY goals_do_usuario ON finance.goals
  USING (user_id = finance.usuario_atual())
  WITH CHECK (user_id = finance.usuario_atual());
