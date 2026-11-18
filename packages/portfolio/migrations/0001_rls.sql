-- Row Level Security do portfolio, e a hypertable de snapshots.
--
-- A RLS e a SEGUNDA barreira. A primeira e o filtro por usuario na consulta da
-- aplicacao. Esta existe para o caso em que a primeira falha: query nova que
-- esquece o WHERE, ID vindo do cliente sem validacao, bug de ORM.
--
-- Tres detalhes sem os quais ela nao protege nada:
--
-- 1. FORCE ROW LEVEL SECURITY. Sem isso o DONO da tabela ignora as politicas,
--    e migration e aplicacao normalmente rodam com o mesmo usuario. A RLS
--    pareceria ativa e nao filtraria nada.
-- 2. A aplicacao conecta com papel SEM BYPASSRLS e que nao e dono das tabelas.
-- 3. O `user_id` vem de `current_setting`, definido com SET LOCAL dentro da
--    transacao. SET (sem LOCAL) vazaria o usuario para a proxima requisicao
--    que pegasse a mesma conexao do pool.

CREATE EXTENSION IF NOT EXISTS timescaledb;
--> statement-breakpoint

-- Snapshot diario por carteira, para todo o universo de usuarios: a tabela de
-- maior cardinalidade do schema.
SELECT create_hypertable(
  'portfolio.snapshots',
  'data',
  chunk_time_interval => INTERVAL '1 month',
  if_not_exists => TRUE,
  migrate_data => TRUE
);
--> statement-breakpoint

-- Papel da aplicacao. NOINHERIT e sem BYPASSRLS: e o que mantem a RLS valendo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bolsiq_app') THEN
    CREATE ROLE bolsiq_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA portfolio TO bolsiq_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA portfolio TO bolsiq_app;
--> statement-breakpoint
-- audit_log e append-only: nem a aplicacao reescreve auditoria.
REVOKE UPDATE, DELETE ON portfolio.audit_log FROM bolsiq_app;
--> statement-breakpoint

-- Funcao auxiliar: le o usuario da sessao e falha alto se nao houver.
-- Devolver NULL silenciosamente faria toda politica virar "nenhuma linha", o
-- que parece seguro e esconde o bug de configuracao.
CREATE OR REPLACE FUNCTION portfolio.usuario_atual() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('bolsiq.user_id', true), '')
$$;
--> statement-breakpoint

ALTER TABLE portfolio.portfolios ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portfolio.portfolios FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY portfolios_do_usuario ON portfolio.portfolios
  USING (user_id = portfolio.usuario_atual())
  WITH CHECK (user_id = portfolio.usuario_atual());
--> statement-breakpoint

ALTER TABLE portfolio.transactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portfolio.transactions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY transactions_do_usuario ON portfolio.transactions
  USING (user_id = portfolio.usuario_atual())
  WITH CHECK (user_id = portfolio.usuario_atual());
--> statement-breakpoint

ALTER TABLE portfolio.snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portfolio.snapshots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY snapshots_do_usuario ON portfolio.snapshots
  USING (user_id = portfolio.usuario_atual())
  WITH CHECK (user_id = portfolio.usuario_atual());
--> statement-breakpoint

ALTER TABLE portfolio.imports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portfolio.imports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY imports_do_usuario ON portfolio.imports
  USING (user_id = portfolio.usuario_atual())
  WITH CHECK (user_id = portfolio.usuario_atual());
--> statement-breakpoint

ALTER TABLE portfolio.audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portfolio.audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- O usuario le a propria auditoria e pode inserir no proprio nome; nao altera
-- nem apaga, garantido tambem pelo REVOKE acima.
CREATE POLICY audit_log_do_usuario ON portfolio.audit_log
  FOR SELECT USING (user_id = portfolio.usuario_atual());
--> statement-breakpoint
CREATE POLICY audit_log_insercao ON portfolio.audit_log
  FOR INSERT WITH CHECK (user_id = portfolio.usuario_atual());
