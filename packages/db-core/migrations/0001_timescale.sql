-- Converte em hypertable as tabelas de série temporal.
--
-- Escrita à mão, de propósito: o drizzle-kit gera tabelas e índices, mas não
-- conhece TimescaleDB. O check `migrations` do CI aplica tudo num banco limpo e
-- depois roda `db:generate` para conferir que nada mais é gerado — e as chamadas
-- abaixo não afetam esse diff, porque não mudam tabela nem coluna.
--
-- `create_hypertable` exige que a coluna de tempo esteja em todo índice único
-- da tabela. É por isso que as chaves primárias de quotes_daily, fund_daily,
-- macro_series e api_usage incluem a coluna de tempo.

CREATE EXTENSION IF NOT EXISTS timescaledb;
--> statement-breakpoint

-- Preços: um chunk por mês. O universo da B3 tem poucos milhares de papéis,
-- então o volume diário é modesto e chunk mensal mantém poucos chunks.
SELECT create_hypertable(
  'market_data.quotes_daily',
  'date',
  chunk_time_interval => INTERVAL '1 month',
  if_not_exists => TRUE,
  migrate_data => TRUE
);
--> statement-breakpoint

-- Fundos: o informe diário cobre dezenas de milhares de fundos por dia, bem
-- mais linhas por dia que os preços, então o chunk é semanal.
SELECT create_hypertable(
  'market_data.fund_daily',
  'date',
  chunk_time_interval => INTERVAL '1 week',
  if_not_exists => TRUE,
  migrate_data => TRUE
);
--> statement-breakpoint

-- Séries macro: poucas séries, poucos pontos por dia. Chunk anual.
SELECT create_hypertable(
  'market_data.macro_series',
  'date',
  chunk_time_interval => INTERVAL '1 year',
  if_not_exists => TRUE,
  migrate_data => TRUE
);
--> statement-breakpoint

-- Uso da API: a tabela de maior cardinalidade do serviço, uma linha por
-- requisição. Chunk diário.
SELECT create_hypertable(
  'market_data.api_usage',
  'ts',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE,
  migrate_data => TRUE
);
