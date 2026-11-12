-- RLS dos jobs de importacao com IA: as regras das outras tabelas do assistente (ADR 0011).
GRANT SELECT, INSERT, UPDATE, DELETE ON assistant.import_jobs, assistant.import_job_files TO bolsiq_app;
--> statement-breakpoint
ALTER TABLE assistant.import_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assistant.import_jobs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY import_jobs_do_usuario ON assistant.import_jobs
  USING (user_id = assistant.usuario_atual())
  WITH CHECK (user_id = assistant.usuario_atual());
--> statement-breakpoint
ALTER TABLE assistant.import_job_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assistant.import_job_files FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY import_job_files_do_usuario ON assistant.import_job_files
  USING (user_id = assistant.usuario_atual())
  WITH CHECK (user_id = assistant.usuario_atual());
