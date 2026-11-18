-- Hypertables do analytics. Escrita a mao: o drizzle-kit nao conhece
-- TimescaleDB, e estas chamadas nao afetam o diff de schema, entao a checagem
-- de drift continua valendo.

CREATE EXTENSION IF NOT EXISTS timescaledb;
--> statement-breakpoint

-- Indicadores: uma linha por ativo por data de referencia. Demonstrativo e
-- trimestral, entao o volume por chunk e baixo; chunk anual mantem poucos
-- chunks e consultas do screener tocando um so.
SELECT create_hypertable(
  'analytics.indicators',
  'reference_date',
  chunk_time_interval => INTERVAL '1 year',
  if_not_exists => TRUE,
  migrate_data => TRUE
);
--> statement-breakpoint

-- Retornos diarios: uma linha por ativo por dia util, para todo o universo.
-- E a tabela de maior cardinalidade do schema; chunk mensal.
SELECT create_hypertable(
  'analytics.daily_returns',
  'date',
  chunk_time_interval => INTERVAL '1 month',
  if_not_exists => TRUE,
  migrate_data => TRUE
);
