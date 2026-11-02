import {
  bigint,
  boolean,
  date,
  index,
  integer,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Schema do serviço market-data.
 *
 * O CLAUDE.md determina um banco por serviço, com schemas separados enquanto
 * estiverem no mesmo cluster. Nenhuma tabela aqui deve ser lida por outro
 * serviço: quem precisa do dado chama a API.
 */
export const marketData = pgSchema("market_data");

/**
 * `numeric` com escala folgada para valor monetário (regra 5 do CLAUDE.md).
 *
 * `mode: "string"` é explícito de propósito. É também o padrão do Drizzle, mas
 * declarar deixa a garantia no tipo em vez de depender de um padrão: devolver
 * `number` faria o valor passar por ponto flutuante na saída do banco,
 * desfazendo a razão de ser do `numeric`.
 */
const money = (nome: string) =>
  numeric(nome, { precision: 20, scale: 6, mode: "string" });

/** Timestamp sempre com fuso, sempre gravado em UTC (regra 5). */
const utc = (nome: string) => timestamp(nome, { withTimezone: true, mode: "string" });

// ---------------------------------------------------------------------------
// Universo de ativos
// ---------------------------------------------------------------------------

export const assets = marketData.table(
  "assets",
  {
    id: text("id").primaryKey(),
    ticker: text("ticker"),
    isin: text("isin"),
    cnpj: text("cnpj"),
    cvmCode: text("cvm_code"),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    kind: text("kind").notNull(),
    sector: text("sector"),
    status: text("status"),
    ownershipType: text("ownership_type"),
    registeredAt: date("registered_at"),

    source: text("source").notNull(),
    fetchedAt: utc("fetched_at").notNull(),
    license: text("license").notNull(),
    sourceRef: text("source_ref").notNull(),

    createdAt: utc("created_at").notNull().defaultNow(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("assets_ticker_uq").on(t.ticker),
    index("assets_cnpj_idx").on(t.cnpj),
    index("assets_cvm_code_idx").on(t.cvmCode),
    index("assets_kind_idx").on(t.kind),
  ],
);

// ---------------------------------------------------------------------------
// Preços — hypertable
// ---------------------------------------------------------------------------

export const quotesDaily = marketData.table(
  "quotes_daily",
  {
    ticker: text("ticker").notNull(),
    date: date("date").notNull(),
    open: money("open").notNull(),
    high: money("high").notNull(),
    low: money("low").notNull(),
    close: money("close").notNull(),
    average: money("average"),
    /** Calculado a partir de `close` e dos proventos; não vem da fonte. */
    adjClose: money("adj_close"),
    volume: bigint("volume", { mode: "bigint" }).notNull(),
    trades: integer("trades").notNull(),
    financialVolume: money("financial_volume").notNull(),
    /** FATCOT do COTAHIST, guardado para auditoria da conversão. */
    quoteFactor: integer("quote_factor").notNull().default(1),

    source: text("source").notNull(),
    fetchedAt: utc("fetched_at").notNull(),
    license: text("license").notNull(),
    sourceRef: text("source_ref").notNull(),
  },
  (t) => [
    // A coluna de tempo precisa estar na chave: o TimescaleDB exige a coluna
    // de particionamento em todo índice único da hypertable.
    primaryKey({ columns: [t.ticker, t.date] }),
    index("quotes_daily_date_idx").on(t.date),
  ],
);

// ---------------------------------------------------------------------------
// Demonstrações financeiras
// ---------------------------------------------------------------------------

export const financialStatements = marketData.table(
  "financial_statements",
  {
    cvmCode: text("cvm_code").notNull(),
    cnpj: text("cnpj").notNull(),
    referenceDate: date("reference_date").notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    statementType: text("statement_type").notNull(),
    isConsolidated: boolean("is_consolidated").notNull(),
    accountCode: text("account_code").notNull(),
    accountLabel: text("account_label").notNull(),
    /** Já normalizado pela ESCALA_MOEDA da CVM: sempre em unidades. */
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    /** VERSAO da CVM. Só a maior vale; guardada para auditoria. */
    version: integer("version").notNull(),

    source: text("source").notNull(),
    fetchedAt: utc("fetched_at").notNull(),
    license: text("license").notNull(),
    sourceRef: text("source_ref").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [
        t.cvmCode,
        t.referenceDate,
        t.statementType,
        t.isConsolidated,
        t.accountCode,
      ],
    }),
    index("financial_statements_cnpj_idx").on(t.cnpj),
    index("financial_statements_reference_date_idx").on(t.referenceDate),
  ],
);

// ---------------------------------------------------------------------------
// Fundos — hypertable
// ---------------------------------------------------------------------------

export const fundDaily = marketData.table(
  "fund_daily",
  {
    cnpjFundo: text("cnpj_fundo").notNull(),
    date: date("date").notNull(),
    nav: money("nav").notNull(),
    aum: money("aum").notNull(),
    inflows: money("inflows"),
    outflows: money("outflows"),
    holders: integer("holders"),
    totalPortfolio: money("total_portfolio"),

    source: text("source").notNull(),
    fetchedAt: utc("fetched_at").notNull(),
    license: text("license").notNull(),
    sourceRef: text("source_ref").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.cnpjFundo, t.date] }),
    index("fund_daily_date_idx").on(t.date),
  ],
);

// ---------------------------------------------------------------------------
// Séries macro — hypertable
// ---------------------------------------------------------------------------

export const macroSeries = marketData.table(
  "macro_series",
  {
    seriesCode: text("series_code").notNull(),
    date: date("date").notNull(),
    value: money("value").notNull(),
    unit: text("unit").notNull(),
    frequency: text("frequency").notNull(),

    source: text("source").notNull(),
    fetchedAt: utc("fetched_at").notNull(),
    license: text("license").notNull(),
    sourceRef: text("source_ref").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.seriesCode, t.date] }),
    index("macro_series_date_idx").on(t.date),
  ],
);

// ---------------------------------------------------------------------------
// Cotação corrente (read-through da brapi)
// ---------------------------------------------------------------------------

/**
 * Última cotação conhecida de cada ticker, com atraso.
 *
 * Uma linha por ticker, sobrescrita a cada leitura da fonte. É o cache do
 * read-through: `fetched_at` decide se a leitura seguinte vai à fonte. O
 * histórico diário continua em `quotes_daily`, que vem do COTAHIST.
 */
export const liveQuotes = marketData.table("live_quotes", {
  ticker: text("ticker").primaryKey(),
  price: money("price").notNull(),
  change: money("change").notNull(),
  changePercent: money("change_percent").notNull(),
  previousClose: money("previous_close"),
  open: money("open"),
  high: money("high"),
  low: money("low"),
  volume: bigint("volume", { mode: "bigint" }),
  /** Instante da cotação na fonte, não o da leitura. */
  quotedAt: utc("quoted_at").notNull(),

  source: text("source").notNull(),
  fetchedAt: utc("fetched_at").notNull(),
  license: text("license").notNull(),
  sourceRef: text("source_ref").notNull(),
});

// ---------------------------------------------------------------------------
// Proventos e eventos societários
// ---------------------------------------------------------------------------

/**
 * Proventos (dividendo, JCP) e eventos que mudam a quantidade de ações
 * (desdobramento, grupamento, bonificação).
 *
 * `ex_date` é o primeiro pregão sem direito. É a data que o ajuste de preço
 * usa: o fechamento da véspera é o último com o provento embutido.
 */
export const dividends = marketData.table(
  "dividends",
  {
    ticker: text("ticker").notNull(),
    exDate: date("ex_date").notNull(),
    kind: text("kind").notNull(),
    /** Valor por ação; nulo em desdobramento e grupamento. */
    valuePerShare: money("value_per_share"),
    /** Multiplicador de ações: 2 em desdobramento 1:2, 0.01 em grupamento 100:1. */
    factor: money("factor"),
    /** Razão como publicada, ex. "2 para 1". */
    ratio: text("ratio"),
    paymentDate: date("payment_date"),
    approvedOn: date("approved_on"),

    source: text("source").notNull(),
    fetchedAt: utc("fetched_at").notNull(),
    license: text("license").notNull(),
    sourceRef: text("source_ref").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ticker, t.exDate, t.kind] })],
);

// ---------------------------------------------------------------------------
// Ações em circulação
// ---------------------------------------------------------------------------

/**
 * Composição do capital, do arquivo `composicao_capital` do DFP/ITR.
 *
 * Gravada como a fonte publica, sem correção: a CVM tem companhias que
 * informam em milhares e outras em unidades no mesmo arquivo, e corrigir por
 * palpite transformaria inconsistência da fonte em dado afirmado.
 */
export const shareCounts = marketData.table(
  "share_counts",
  {
    cnpj: text("cnpj").notNull(),
    referenceDate: date("reference_date").notNull(),
    common: bigint("common", { mode: "bigint" }).notNull(),
    preferred: bigint("preferred", { mode: "bigint" }).notNull(),
    total: bigint("total", { mode: "bigint" }).notNull(),
    treasuryTotal: bigint("treasury_total", { mode: "bigint" }).notNull(),
    version: integer("version").notNull(),

    source: text("source").notNull(),
    fetchedAt: utc("fetched_at").notNull(),
    license: text("license").notNull(),
    sourceRef: text("source_ref").notNull(),
  },
  (t) => [primaryKey({ columns: [t.cnpj, t.referenceDate] })],
);

// ---------------------------------------------------------------------------
// Idempotência de carga
// ---------------------------------------------------------------------------

/**
 * Registro de cada arquivo baixado, com o hash do conteúdo.
 *
 * É o primeiro nível de idempotência: hash igual, não reprocessa. O segundo
 * nível é a chave natural de cada tabela, que torna o reprocessamento seguro
 * mesmo quando este registro é apagado de propósito.
 * Ver docs/runbooks/reprocessar-fonte.md.
 */
export const fetchLog = marketData.table(
  "fetch_log",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    sourceRef: text("source_ref").notNull(),
    contentHash: text("content_hash").notNull(),
    bytes: bigint("bytes", { mode: "bigint" }),
    status: text("status").notNull(),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(1),
    rowsWritten: integer("rows_written"),
    fetchedAt: utc("fetched_at").notNull(),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    uniqueIndex("fetch_log_source_ref_uq").on(t.source, t.sourceRef, t.contentHash),
    index("fetch_log_source_fetched_at_idx").on(t.source, t.fetchedAt),
    index("fetch_log_status_idx").on(t.status),
  ],
);
