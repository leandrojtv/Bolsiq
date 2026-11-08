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
  ('HGLG11', 'HGLG11', 'BRHGLGCTF004', '11728688000147', NULL, 'CSHG LOG', NULL, 'fii', NULL, NULL, 'b3-cotahist', now(), 'proprietaria B3, sem direito de redistribuicao', 'seed-e2e'),
  ('KNCR11', 'KNCR11', 'BRKNCRCTF000', '16706958000132', NULL, 'KINEA RENDIM', NULL, 'fii', NULL, NULL, 'b3-cotahist', now(), 'proprietaria B3, sem direito de redistribuicao', 'seed-e2e'),
  ('XPML11', 'XPML11', 'BRXPMLCTF000', '28757546000100', NULL, 'XP MALLS', NULL, 'fii', NULL, NULL, 'b3-cotahist', now(), 'proprietaria B3, sem direito de redistribuicao', 'seed-e2e'),
  ('BOVA11', 'BOVA11', 'BRBOVACTF003', NULL, NULL, 'ISHARES BOVA', NULL, 'etf', NULL, NULL, 'b3-cotahist', now(), 'proprietaria B3, sem direito de redistribuicao', 'seed-e2e'),
  -- Importacao com IA: a posicao da XP traz MXRF11.
  ('MXRF11', 'MXRF11', 'BRMXRFCTF002', '97521225000125', NULL, 'MAXI RENDA', NULL, 'fii', NULL, NULL, 'b3-cotahist', now(), 'proprietaria B3, sem direito de redistribuicao', 'seed-e2e')
ON CONFLICT (id) DO NOTHING;

-- 180 dias uteis ate ontem, com tendencia e oscilacao deterministica.
INSERT INTO market_data.quotes_daily (ticker, date, open, high, low, close, average, volume, trades, financial_volume, source, fetched_at, license, source_ref)
SELECT t.ticker, d::date,
       round(p - 0.3, 2), round(p + 0.6, 2), round(p - 0.7, 2), round(p, 2), round(p, 2),
       40000000 + (n % 7) * 3000000, 50000, round(p * 40000000, 2),
       'b3-cotahist', now(), 'proprietaria B3, sem direito de redistribuicao', 'seed-e2e'
FROM (VALUES ('PETR4', 38.0), ('VALE3', 60.0), ('ITUB4', 35.0), ('PRIO3', 40.0), ('HGLG11', 160.0), ('KNCR11', 85.0), ('XPML11', 92.0), ('BOVA11', 130.0)) AS t(ticker, base),
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
  ('HGLG11', 'CSHG LOG', 'fii', NULL, NULL),
  ('KNCR11', 'KINEA RENDIM', 'fii', NULL, NULL),
  ('XPML11', 'XP MALLS', 'fii', NULL, NULL)
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

-- Informe mensal de FII: 12 competencias reais da CVM (out/2025 a set/2026),
-- com os meses de DY negativo que a fonte publica (XPML11 em jan e set/2026).
-- Os indicadores desses FIIs nao sao semeados: o e2e publica
-- fii.report.published e confere o que o analytics-worker calculou.
INSERT INTO market_data.fii_monthly (cnpj, reference_date, version, isin, name, segment, total_assets, equity, shares_outstanding, nav_per_share, holders, dividend_yield_month, effective_return_month, amortization_month, source, fetched_at, license, source_ref)
SELECT v.cnpj, v.reference_date::date, v.version, v.isin, v.name, v.segment, v.total_assets, v.equity, v.shares_outstanding, v.nav_per_share, v.holders, v.dividend_yield_month, v.effective_return_month, v.amortization_month,
       'cvm-fii-mensal', now(), 'ODbL-1.0', 'seed-e2e'
FROM (VALUES
  ('11728688000147', '2025-10-01', 1, 'BRHGLGCTF004', 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO', 'Multicategoria', 6357064276.08, 5481659231.32, 33787575, 162.238907, 512965, 0.006769, 0.005173, 0),
  ('11728688000147', '2025-11-01', 1, 'BRHGLGCTF004', 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO', 'Multicategoria', 8315604330.71, 7030245156.84, 42404675, 165.789389, 516205, 0.005901, 0.027785, 0),
  ('11728688000147', '2025-12-01', 1, 'BRHGLGCTF004', 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO', 'Multicategoria', 8350420491.26, 7063626090.23, 42404675, 166.576588, 525069, 0.006635, 0.011383, 0),
  ('11728688000147', '2026-01-01', 1, 'BRHGLGCTF004', 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO', 'Multicategoria', 8384622828.19, 7056514999, 42404675, 166.408892, 536031, 0.006604, 0.005597, 0),
  ('11728688000147', '2026-02-01', 1, 'BRHGLGCTF004', 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO', 'Multicategoria', 8340995220.83, 7028329076.74, 42404675, 165.744203, 544807, 0.00661, 0.002612, 0),
  ('11728688000147', '2026-03-01', 1, 'BRHGLGCTF004', 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO', 'Multicategoria', 8339462292.16, 7026989403.76, 42404675, 165.712611, 555579, 0.006637, 0.006446, 0),
  ('11728688000147', '2026-04-01', 2, 'BRHGLGCTF004', 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO', 'Multicategoria', 8530026492.76, 7234911197.7, 43455524, 166.490023, 565330, 0.006477, 0.011168, 0),
  ('11728688000147', '2026-05-01', 1, 'BRHGLGCTF004', 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO', 'Multicategoria', 8868525574.49, 7570056166.4, 45601745, 166.003651, 573386, 0.006607, 0.003686, 0),
  ('11728688000147', '2026-06-01', 1, 'BRHGLGCTF004', 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO', 'Multicategoria', 8878850947.95, 7597392215.14, 45601745, 166.603103, 587366, 0.006626, 0.010237, 0),
  ('11728688000147', '2026-07-01', 1, 'BRHGLGCTF004', 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO', 'Multicategoria', 8875438220.18, 7589554105.43, 45601745, 166.431221, 608345, 0.007023, 0.005991, 0),
  ('11728688000147', '2026-08-01', 2, 'BRHGLGCTF004', 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO', 'Multicategoria', 8850561499.23, 7567668488.14, 45601713, 165.951408, 608345, 0.007027, 0.004143, 0),
  ('11728688000147', '2026-09-01', 1, 'BRHGLGCTF004', 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO', 'Multicategoria', 8835655334.84, 7546017797.39, 45601713, 165.47663, 613837, 0.007052, 0.004191, 0),
  ('16706958000132', '2025-10-01', 1, 'BRKNCRCTF000', 'KINEA RENDIMENTOS IMOBILIARIOS FII RESPONSABILIDADE LIMITADA', 'Multicategoria', 9938722891.24, 9171360996.84, 89911115, 102.004752, 455519, 0.011741, 0.012074, 0),
  ('16706958000132', '2025-11-01', 1, 'BRKNCRCTF000', 'KINEA RENDIMENTOS IMOBILIARIOS FII RESPONSABILIDADE LIMITADA', 'Multicategoria', 9519112733.52, 9403069963.17, 92078102, 102.120588, 466583, 0.010882, 0.012018, 0),
  ('16706958000132', '2025-12-01', 1, 'BRKNCRCTF000', 'KINEA RENDIMENTOS IMOBILIARIOS FII RESPONSABILIDADE LIMITADA', 'Multicategoria', 9880725282.76, 9741403716, 95264832, 102.256032, 478976, 0.01273, 0.014056, 0),
  ('16706958000132', '2026-01-01', 1, 'BRKNCRCTF000', 'KINEA RENDIMENTOS IMOBILIARIOS FII RESPONSABILIDADE LIMITADA', 'Multicategoria', 10529985500.46, 10381050207.72, 101508771, 102.267519, 497709, 0.011735, 0.011847, 0),
  ('16706958000132', '2026-02-01', 1, 'BRKNCRCTF000', 'KINEA RENDIMENTOS IMOBILIARIOS FII RESPONSABILIDADE LIMITADA', 'Multicategoria', 11097873988.88, 10954106977.35, 107089622, 102.289155, 510621, 0.009778, 0.00999, 0),
  ('16706958000132', '2026-03-01', 1, 'BRKNCRCTF000', 'KINEA RENDIMENTOS IMOBILIARIOS FII RESPONSABILIDADE LIMITADA', 'Multicategoria', 11099679567.64, 10962220583.14, 107089622, 102.36492, 542237, 0.011243, 0.011984, 0),
  ('16706958000132', '2026-04-01', 1, 'BRKNCRCTF000', 'KINEA RENDIMENTOS IMOBILIARIOS FII RESPONSABILIDADE LIMITADA', 'Multicategoria', 11094628084.36, 10964349587.96, 107089622, 102.384801, 549972, 0.010746, 0.01094, 0),
  ('16706958000132', '2026-05-01', 1, 'BRKNCRCTF000', 'KINEA RENDIMENTOS IMOBILIARIOS FII RESPONSABILIDADE LIMITADA', 'Multicategoria', 11094140356.96, 10963961899.61, 107089622, 102.38118, 558989, 0.010744, 0.010709, 0),
  ('16706958000132', '2026-06-01', 1, 'BRKNCRCTF000', 'KINEA RENDIMENTOS IMOBILIARIOS FII RESPONSABILIDADE LIMITADA', 'Multicategoria', 11102998685.27, 10974808568.74, 107089622, 102.482466, 592231, 0.010744, 0.011733, 0),
  ('16706958000132', '2026-07-01', 1, 'BRKNCRCTF000', 'KINEA RENDIMENTOS IMOBILIARIOS FII RESPONSABILIDADE LIMITADA', 'Multicategoria', 11124050922.01, 10978689824.66, 107089622, 102.518709, 578802, 0.012197, 0.012551, 0),
  ('16706958000132', '2026-08-01', 2, 'BRKNCRCTF000', 'KINEA RENDIMENTOS IMOBILIARIOS FII RESPONSABILIDADE LIMITADA', 'Multicategoria', 11125061857.31, 10991179817.17, 107089622, 102.63534, 586131, 0.011217, 0.012355, 0),
  ('16706958000132', '2026-09-01', 1, 'BRKNCRCTF000', 'KINEA RENDIMENTOS IMOBILIARIOS FII RESPONSABILIDADE LIMITADA', 'Multicategoria', 11126511594.66, 10984431830.65, 107089622, 102.572328, 593709, 0.01101, 0.010396, 0),
  ('28757546000100', '2025-10-01', 1, 'BRXPMLCTF000', 'XP MALLS FII', 'Shoppings', 7884699891.37, 6368330180.09, 58567574, 108.734744, 626958, 0.006645, 0.006711, 0),
  ('28757546000100', '2025-11-01', 2, 'BRXPMLCTF000', 'XP MALLS FII', 'Shoppings', 7871509108.35, 6333860101.76, 58559855, 108.160447, 633076, 0.01196, 0.006678, 0),
  ('28757546000100', '2025-12-01', 1, 'BRXPMLCTF000', 'XP MALLS FII', 'Shoppings', 7871509108.35, 6333860101.76, 58559855, 108.160447, 633076, 0.01196, 0.006678, 0),
  ('28757546000100', '2026-01-01', 1, 'BRXPMLCTF000', 'XP MALLS FII', 'Shoppings', 7208355023.72, 6493770567.45, 58559855, 110.891165, 656376, -0.058778, -0.033531, 0),
  ('28757546000100', '2026-02-01', 2, 'BRXPMLCTF000', 'XP MALLS FII', 'Shoppings', 7463772204.31, 6468497036.42, 58559855, 110.459581, 704717, 0.002743, 0.010741, 0),
  ('28757546000100', '2026-03-01', 2, 'BRXPMLCTF000', 'XP MALLS FII', 'Shoppings', 8174962971.75, 7090332563.62, 64308055, 110.255746, 722253, 0.003294, 0.001449, 0),
  ('28757546000100', '2026-04-01', 2, 'BRXPMLCTF000', 'XP MALLS FII', 'Shoppings', 8123564947.85, 7081112753.36, 64308055, 110.112376, 733101, 0.007788, 0.006488, 0),
  ('28757546000100', '2026-05-01', 2, 'BRXPMLCTF000', 'XP MALLS FII', 'Shoppings', 8113515705.36, 7034476644.18, 64308055, 109.387178, 748369, 0.013427, 0.006841, 0),
  ('28757546000100', '2026-06-01', 2, 'BRXPMLCTF000', 'XP MALLS FII', 'Shoppings', 7990712372.38, 6902422825.57, 64308055, 107.333721, 763193, 0.005859, -0.012913, 0),
  ('28757546000100', '2026-07-01', 2, 'BRXPMLCTF000', 'XP MALLS FII', 'Shoppings', 7999970934.26, 6899543812.51, 64308055, 107.288952, 779085, 0.010212, 0.009795, 0),
  ('28757546000100', '2026-08-01', 2, 'BRXPMLCTF000', 'XP MALLS FII', 'Shoppings', 7999272775.51, 6902667484.7, 64308055, 107.337525, 785753, 0.008757, 0.00921, 0),
  ('28757546000100', '2026-09-01', 1, 'BRXPMLCTF000', 'XP MALLS FII', 'Shoppings', 7935007345.69, 6904091273.75, 64308055, 107.359665, 795394, -0.001103, -0.000897, 0)
) AS v(cnpj, reference_date, version, isin, name, segment, total_assets, equity, shares_outstanding, nav_per_share, holders, dividend_yield_month, effective_return_month, amortization_month)
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
  (gen_random_uuid()::text, 'bcb-sgs-cobertura', '433', '1990-01-01', 'ok', now()),
  -- Sem BRAPI_TOKEN a brapi nao tem proventos de FII: o cache negativo evita a
  -- ida a rede no CI, e o DY 12m vem do informe mensal.
  (gen_random_uuid()::text, 'brapi-dividends-indisponivel', 'HGLG11', 'seed-e2e', 'ok', now()),
  (gen_random_uuid()::text, 'brapi-dividends-indisponivel', 'KNCR11', 'seed-e2e', 'ok', now()),
  (gen_random_uuid()::text, 'brapi-dividends-indisponivel', 'XPML11', 'seed-e2e', 'ok', now())
ON CONFLICT DO NOTHING;

COMMIT;
