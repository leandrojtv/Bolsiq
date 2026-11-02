import {
  bigint,
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
import { sql } from "drizzle-orm";
import { tabelasDeConsumidor } from "@bolsiq/db-core";

/**
 * Schema proprio do analytics.
 *
 * Separado de `market_data` de proposito: o analytics le dado de mercado pela
 * API /v1 ou por evento, nunca pelo schema do outro servico. Com os dois no
 * mesmo schema, o primeiro join entre eles apagaria a fronteira sem ninguem
 * notar, e o modulo deixaria de poder virar servico (ADR 0009).
 */
export const analytics = pgSchema("analytics");

const utc = (nome: string) => timestamp(nome, { withTimezone: true, mode: "string" });
/** Razoes e percentuais: adimensionais, nao monetarios. */
const razao = (nome: string) => numeric(nome, { precision: 18, scale: 6 });
/** Valores em reais (regra 5). */
const money = (nome: string) => numeric(nome, { precision: 20, scale: 6 });

/**
 * Historico de indicadores por ativo. Hypertable por `reference_date`.
 *
 * Toda coluna de indicador e nula por escolha: indicador indefinido (P/L de
 * empresa sem lucro, CAGR a partir de prejuizo) tem de ser distinguivel de
 * zero. Gravar zero ali faria o screener ordenar por um valor que nao existe.
 */
export const indicators = analytics.table(
  "indicators",
  {
    ticker: text("ticker").notNull(),
    reference_date: date("reference_date").notNull(),
    kind: text("kind").notNull(),

    lpa: money("lpa"),
    vpa: money("vpa"),
    ebitda: money("ebitda"),
    divida_liquida: money("divida_liquida"),

    pl: razao("pl"),
    pvp: razao("pvp"),
    ev_ebitda: razao("ev_ebitda"),
    ev_ebit: razao("ev_ebit"),
    p_receita: razao("p_receita"),
    dy_12m: razao("dy_12m"),
    dy_medio_5a: razao("dy_medio_5a"),

    roe: razao("roe"),
    roic: razao("roic"),
    roa: razao("roa"),
    margem_bruta: razao("margem_bruta"),
    margem_ebitda: razao("margem_ebitda"),
    margem_liquida: razao("margem_liquida"),

    dl_ebitda: razao("dl_ebitda"),
    dl_pl: razao("dl_pl"),
    liquidez_corrente: razao("liquidez_corrente"),

    cagr_receita_5a: razao("cagr_receita_5a"),
    cagr_lucro_5a: razao("cagr_lucro_5a"),

    preco_graham: money("preco_graham"),
    margem_graham: razao("margem_graham"),
    preco_bazin: money("preco_bazin"),
    margem_bazin: razao("margem_bazin"),

    retorno_periodo: razao("retorno_periodo"),
    volatilidade_anual: razao("volatilidade_anual"),
    drawdown_maximo: razao("drawdown_maximo"),
    sharpe: razao("sharpe"),
    beta: razao("beta"),

    /** Volume financeiro medio diario, para o filtro de liquidez. */
    liquidez_diaria: money("liquidez_diaria"),
    /** FIIs: vacancia fisica, quando o relatorio gerencial traz. */
    vacancia: razao("vacancia"),
    /** Fundos: patrimonio e cotistas. */
    patrimonio_liquido: money("patrimonio_liquido"),
    cotistas: integer("cotistas"),

    /**
     * De onde veio a entrada do calculo. Nao e a proveniencia do dado bruto,
     * que fica no market-data: e o rastro de qual demonstrativo e qual preco
     * geraram estes numeros.
     */
    fonte_demonstrativo: text("fonte_demonstrativo"),
    calculado_em: utc("calculado_em").notNull().defaultNow(),
  },
  (t) => [
    // Coluna de tempo na chave: exigencia do TimescaleDB para hypertable.
    primaryKey({ columns: [t.ticker, t.reference_date] }),
    index("indicators_reference_date_idx").on(t.reference_date),
    index("indicators_kind_idx").on(t.kind),
    // Indices dos filtros mais usados do screener. Parciais, porque linha com
    // indicador nulo nunca satisfaz uma faixa e so inflaria o indice.
    index("indicators_pl_idx").on(t.pl),
    index("indicators_pvp_idx").on(t.pvp),
    index("indicators_roe_idx").on(t.roe),
    index("indicators_dy_medio_idx").on(t.dy_medio_5a),
    index("indicators_ev_ebit_idx").on(t.ev_ebit),
    index("indicators_liquidez_idx").on(t.liquidez_diaria),
  ],
);

/**
 * Espelho local do universo de ativos, alimentado por
 * `marketdata.asset.listed` e `delisted`.
 *
 * E copia, nao fonte: o dono do universo e o market-data. Existe para o
 * screener filtrar por setor e tipo sem uma chamada de API por linha, o que
 * tornaria impossivel a meta de 300 ms.
 */
export const assets_mirror = analytics.table(
  "assets_mirror",
  {
    ticker: text("ticker").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    sector: text("sector"),
    cvm_code: text("cvm_code"),
    listed: text("listed").notNull().default("true"),
    atualizado_em: utc("atualizado_em").notNull().defaultNow(),
  },
  (t) => [index("assets_mirror_kind_sector_idx").on(t.kind, t.sector)],
);

/** Serie de retornos diarios, base do desempenho e dos benchmarks. */
export const daily_returns = analytics.table(
  "daily_returns",
  {
    ticker: text("ticker").notNull(),
    date: date("date").notNull(),
    retorno: razao("retorno").notNull(),
    /** Base 100 acumulada, para o comparador nao recalcular a cada request. */
    base_100: razao("base_100"),
    volume_financeiro: money("volume_financeiro"),
    atualizado_em: utc("atualizado_em").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ticker, t.date] }),
    index("daily_returns_date_idx").on(t.date),
  ],
);

/** Recalculos pendentes, enfileirados pelos eventos do market-data. */
export const recalc_queue = analytics.table(
  "recalc_queue",
  {
    id: text("id").primaryKey(),
    ticker: text("ticker"),
    motivo: text("motivo").notNull(),
    event_id: text("event_id"),
    enfileirado_em: utc("enfileirado_em").notNull().defaultNow(),
    processado_em: utc("processado_em"),
    tentativas: integer("tentativas").notNull().default(0),
    bytes_lidos: bigint("bytes_lidos", { mode: "number" }),
  },
  (t) => [
    index("recalc_queue_pendente_idx").on(t.enfileirado_em),
    // Um pendente por ticker: 700 statement.published e um daily.closed no
    // mesmo minuto viram um recalculo por papel, nao dois mil.
    uniqueIndex("recalc_queue_ticker_pendente_uq")
      .on(t.ticker)
      .where(sql`processado_em IS NULL`),
  ],
);

/** Idempotencia e dead-letter do consumidor de eventos do analytics. */
export const { processedEvents, deadLetter } = tabelasDeConsumidor("analytics");
