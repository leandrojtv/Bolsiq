-- Dados minimos para o e2e do apps/web no CI.
--
-- O compose do CI sobe com o banco vazio, e o backfill real baixa centenas de
-- MB. Isto grava o necessario para /ativo/PETR4: cadastro, 180 pregoes,
-- demonstrativo, acoes, proventos e indicadores. Valores do DFP 2024 real da
-- Petrobras; precos sinteticos.

BEGIN;

INSERT INTO market_data.assets (id, ticker, isin, cnpj, cvm_code, name, legal_name, kind, sector, status, source, fetched_at, license, source_ref)
VALUES
  ('PETR4', 'PETR4', 'BRPETRACNPR6', '33000167000101', '009512', 'PETROBRAS', 'PETROLEO BRASILEIRO S.A. PETROBRAS', 'stock', 'Petróleo e Gás', 'ATIVO', 'b3-cotahist', now(), 'proprietaria B3, sem direito de redistribuicao', 'seed-e2e'),
  ('VALE3', 'VALE3', 'BRVALEACNOR0', '33592510000154', '004170', 'VALE', 'VALE S.A.', 'stock', 'Extração Mineral', 'ATIVO', 'b3-cotahist', now(), 'proprietaria B3, sem direito de redistribuicao', 'seed-e2e'),
  ('ITUB4', 'ITUB4', 'BRITUBACNPR1', NULL, NULL, 'ITAUUNIBANCO', NULL, 'stock', NULL, NULL, 'b3-cotahist', now(), 'proprietaria B3, sem direito de redistribuicao', 'seed-e2e'),
  ('PRIO3', 'PRIO3', 'BRPRIOACNOR1', NULL, NULL, 'PETRORIO', NULL, 'stock', 'Petróleo e Gás', NULL, 'b3-cotahist', now(), 'proprietaria B3, sem direito de redistribuicao', 'seed-e2e'),
  ('HGLG11', 'HGLG11', 'BRHGLGCTF004', NULL, NULL, 'CSHG LOG', NULL, 'fii', NULL, NULL, 'b3-cotahist', now(), 'proprietaria B3, sem direito de redistribuicao', 'seed-e2e'),
  ('BOVA11', 'BOVA11', 'BRBOVACTF003', NULL, NULL, 'ISHARES BOVA', NULL, 'etf', NULL, NULL, 'b3-cotahist', now(), 'proprietaria B3, sem direito de redistribuicao', 'seed-e2e')
ON CONFLICT (id) DO NOTHING;

-- 180 dias uteis ate ontem, com tendencia e oscilacao deterministica.
INSERT INTO market_data.quotes_daily (ticker, date, open, high, low, close, average, volume, trades, financial_volume, source, fetched_at, license, source_ref)
SELECT t.ticker, d::date,
       round(p - 0.3, 2), round(p + 0.6, 2), round(p - 0.7, 2), round(p, 2), round(p, 2),
       40000000 + (n % 7) * 3000000, 50000, round(p * 40000000, 2),
       'b3-cotahist', now(), 'proprietaria B3, sem direito de redistribuicao', 'seed-e2e'
FROM (VALUES ('PETR4', 38.0), ('VALE3', 60.0), ('ITUB4', 35.0), ('PRIO3', 40.0), ('HGLG11', 160.0), ('BOVA11', 130.0)) AS t(ticker, base),
LATERAL (
  SELECT d, row_number() OVER (ORDER BY d) AS n
  FROM generate_series(current_date - 260, current_date - 1, interval '1 day') AS d
  WHERE extract(isodow FROM d) < 6
) dias,
LATERAL (SELECT (t.base + n * 0.05 + sin(n / 5.0) * 1.5)::numeric AS p) preco
ON CONFLICT DO NOTHING;

INSERT INTO market_data.financial_statements (cvm_code, cnpj, reference_date, period_start, period_end, statement_type, is_consolidated, account_code, account_label, amount, currency, version, source, fetched_at, license, source_ref)
SELECT '009512', '33000167000101', '2024-12-31', s.ini::date, '2024-12-31', s.tipo, true, s.conta, s.rotulo, s.valor, 'REAL', 1, 'cvm-dfp', now(), 'ODbL-1.0', 'seed-e2e'
FROM (VALUES
  ('DRE', '3.01', 'Receita de Venda de Bens e/ou Serviços', 490829000000, '2024-01-01'),
  ('DRE', '3.03', 'Resultado Bruto', 246462000000, '2024-01-01'),
  ('DRE', '3.05', 'Resultado Antes do Resultado Financeiro e dos Tributos', 137201000000, '2024-01-01'),
  ('DRE', '3.11', 'Lucro/Prejuízo Consolidado do Período', 37009000000, '2024-01-01'),
  ('BPA', '1', 'Ativo Total', 1124797000000, NULL),
  ('BPA', '1.01', 'Ativo Circulante', 135212000000, NULL),
  ('BPA', '1.01.01', 'Caixa e Equivalentes de Caixa', 20254000000, NULL),
  ('BPP', '2.01', 'Passivo Circulante', 194808000000, NULL),
  ('BPP', '2.01.04', 'Empréstimos e Financiamentos', 68783000000, NULL),
  ('BPP', '2.02.01', 'Empréstimos e Financiamentos', 304684000000, NULL),
  ('BPP', '2.03', 'Patrimônio Líquido Consolidado', 367514000000, NULL),
  ('DFC', '6.01.01.04', 'Depreciação, depleção e amortização', 67033000000, '2024-01-01')
) AS s(tipo, conta, rotulo, valor, ini)
ON CONFLICT DO NOTHING;

INSERT INTO market_data.share_counts (cnpj, reference_date, common, preferred, total, treasury_total, version, source, fetched_at, license, source_ref)
VALUES ('33000167000101', '2024-12-31', 7442454142, 5602042788, 13044496930, 155764169, 1, 'cvm-dfp', now(), 'ODbL-1.0', 'seed-e2e')
ON CONFLICT DO NOTHING;

INSERT INTO market_data.dividends (ticker, ex_date, kind, value_per_share, payment_date, source, fetched_at, license, source_ref)
VALUES
  ('PETR4', current_date - 200, 'dividendo', 0.95, current_date - 150, 'brapi', now(), 'brapi.dev, termos de uso', 'seed-e2e'),
  ('PETR4', current_date - 100, 'jcp', 0.47, current_date - 40, 'brapi', now(), 'brapi.dev, termos de uso', 'seed-e2e'),
  ('PETR4', current_date - 420, 'dividendo', 2.10, current_date - 380, 'brapi', now(), 'brapi.dev, termos de uso', 'seed-e2e')
ON CONFLICT DO NOTHING;

INSERT INTO analytics.assets_mirror (ticker, name, kind, sector, cvm_code)
VALUES
  ('PETR4', 'PETROBRAS', 'stock', 'Petróleo e Gás', '009512'),
  ('VALE3', 'VALE', 'stock', 'Extração Mineral', '004170'),
  ('PRIO3', 'PETRORIO', 'stock', 'Petróleo e Gás', NULL),
  ('HGLG11', 'CSHG LOG', 'fii', NULL, NULL)
ON CONFLICT DO NOTHING;

-- PRIO3 passa no Graham (margem >= 0,2, P/L 0-15, P/VP 0-1,5); VALE3 tem a
-- margem mas nao o P/L; PETR4 nao tem a margem. O e2e confere a linha.
INSERT INTO analytics.indicators (ticker, reference_date, kind, preco, pl, pvp, dy_12m, ev_ebitda, roe, margem_liquida, dl_ebitda, beta, preco_graham, margem_graham, preco_bazin, margem_bazin, liquidez_diaria)
VALUES
  ('PETR4', '2024-12-31', 'stock', 38.5, 16.37, 1.65, 0.077, 4.47, 0.1007, 0.0754, 1.73, 0.51, 42.92, 0.08, 23.67, -0.62, 1500000000),
  ('VALE3', '2024-12-31', 'stock', 60.2, 20.1, 1.40, 0.090, 5.10, 0.0630, 0.1480, 0.91, 0.80, 80.00, 0.25, 70.00, 0.14, 1200000000),
  ('PRIO3', '2024-12-31', 'stock', 41.0, 8.20, 1.10, 0.010, 3.20, 0.2500, 0.3100, 0.80, 1.10, 63.00, 0.35, 12.00, -0.70, 400000000),
  ('HGLG11', '2026-10-30', 'fii', 161.0, NULL, NULL, 0.085, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 230.00, 0.30, 9000000)
ON CONFLICT DO NOTHING;

-- Fundo com um ano de cotas.
INSERT INTO market_data.funds (cnpj, name, class_type, classification, status, aum, aum_date, source, fetched_at, license, source_ref)
VALUES ('07455507000189', 'VERDE MASTER FUNDO DE INVESTIMENTO FINANCEIRO MULTIMERCADO', 'Classes de Cotas de Fundos FIF', 'Multimercado', 'Em Funcionamento Normal', 5720008737.68, current_date - 30, 'cvm-fundos', now(), 'ODbL-1.0', 'seed-e2e')
ON CONFLICT DO NOTHING;

INSERT INTO market_data.fund_daily (cnpj_fundo, date, nav, aum, holders, source, fetched_at, license, source_ref)
SELECT '07455507000189', d::date, round((300 + n * 0.12 + sin(n / 9.0) * 2)::numeric, 6), 5700000000, 10, 'cvm-fundos', now(), 'ODbL-1.0', 'seed-e2e'
FROM (
  SELECT d, row_number() OVER (ORDER BY d) AS n
  FROM generate_series(current_date - 400, current_date - 2, interval '1 day') AS d
  WHERE extract(isodow FROM d) < 6
) dias
ON CONFLICT DO NOTHING;

-- CDI (12, % ao dia) e IPCA (433, % ao mes), com a marca de leitura recente
-- para o read-through nao ir ao Banco Central no CI.
INSERT INTO market_data.macro_series (series_code, date, value, unit, frequency, source, fetched_at, license, source_ref)
SELECT '12', d::date, 0.050788, '% no dia útil', 'daily', 'bcb-sgs', now(), 'dados abertos BCB', 'seed-e2e'
FROM generate_series(current_date - 2000, current_date - 1, interval '1 day') AS d
WHERE extract(isodow FROM d) < 6
ON CONFLICT DO NOTHING;
INSERT INTO market_data.macro_series (series_code, date, value, unit, frequency, source, fetched_at, license, source_ref)
SELECT '433', date_trunc('month', d)::date, 0.40, '% no mês', 'monthly', 'bcb-sgs', now(), 'dados abertos BCB', 'seed-e2e'
FROM generate_series(current_date - 2000, current_date - 30, interval '1 month') AS d
ON CONFLICT DO NOTHING;
INSERT INTO market_data.fetch_log (id, source, source_ref, content_hash, status, fetched_at)
VALUES
  (gen_random_uuid()::text, 'bcb-sgs', '12', 'seed-e2e', 'ok', now()),
  (gen_random_uuid()::text, 'bcb-sgs', '433', 'seed-e2e', 'ok', now()),
  (gen_random_uuid()::text, 'bcb-sgs-cobertura', '12', '1990-01-01', 'ok', now()),
  (gen_random_uuid()::text, 'bcb-sgs-cobertura', '433', '1990-01-01', 'ok', now())
ON CONFLICT DO NOTHING;

COMMIT;
