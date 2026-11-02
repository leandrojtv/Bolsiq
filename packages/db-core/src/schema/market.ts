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
