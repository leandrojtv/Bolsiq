-- RLS do patrimonio e do vigia, no padrao de 0001_rls.sql. DELETE e da exclusao
-- da conta (LGPD). A dead-letter e so do publicador (dono das tabelas): a
-- aplicacao nao tem grant nela.
GRANT SELECT, INSERT, DELETE ON finance.net_worth_snapshots, finance.emitted_alerts TO bolsiq_app;
--> statement-breakpoint
ALTER TABLE finance.net_worth_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.net_worth_snapshots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY net_worth_snapshots_do_usuario ON finance.net_worth_snapshots
  USING (user_id = finance.usuario_atual())
  WITH CHECK (user_id = finance.usuario_atual());
--> statement-breakpoint
ALTER TABLE finance.emitted_alerts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE finance.emitted_alerts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY emitted_alerts_do_usuario ON finance.emitted_alerts
  USING (user_id = finance.usuario_atual())
  WITH CHECK (user_id = finance.usuario_atual());
