import {
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
 * Schema proprio do portfolio.
 *
 * Nao le `market_data` nem `analytics`: preco e evento corporativo entram pela
 * API /v1 ou por evento, pelo mesmo motivo do ADR 0009.
 */
export const portfolio = pgSchema("portfolio");

const utc = (nome: string) => timestamp(nome, { withTimezone: true, mode: "string" });
const money = (nome: string) => numeric(nome, { precision: 20, scale: 6 });
/** Quantidade: fracionario existe em FII e em fundo. */
const quantidade = (nome: string) => numeric(nome, { precision: 20, scale: 8 });

export const portfolios = portfolio.table(
  "portfolios",
  {
    id: text("id").primaryKey(),
    /** Dono. Toda consulta filtra por ele, e a RLS e a segunda barreira. */
    user_id: text("user_id").notNull(),
    nome: text("nome").notNull(),
    moeda: text("moeda").notNull().default("BRL"),
    corretora_padrao: text("corretora_padrao"),
    arquivada: boolean("arquivada").notNull().default(false),
    criada_em: utc("criada_em").notNull().defaultNow(),
  },
  (t) => [
    index("portfolios_user_idx").on(t.user_id),
    uniqueIndex("portfolios_user_nome_uq").on(t.user_id, t.nome),
  ],
);

/**
 * Transacoes.
 *
 * `user_id` e redundante com `portfolios.user_id` de proposito: sem ele, a
 * politica de RLS desta tabela precisaria de subconsulta no portfolios a cada
 * linha, e o planejador nao consegue usar indice nisso. Duplicar o dono e o
 * preco de a RLS ser barata.
 */
export const transactions = portfolio.table(
  "transactions",
  {
    id: text("id").primaryKey(),
    portfolio_id: text("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    user_id: text("user_id").notNull(),
    ticker: text("ticker").notNull(),
    tipo: text("tipo").notNull(),
    data: date("data").notNull(),
    quantidade: quantidade("quantidade").notNull(),
    /** Preco unitario. Zero em desdobramento e em bonificacao. */
    preco: money("preco").notNull(),
    taxas: money("taxas").notNull().default("0"),
    corretora: text("corretora"),
    observacao: text("observacao"),
    /**
     * Evento de mercado que gerou a transacao, quando foi automatica.
     * Nulo em transacao lancada pelo usuario. E o que torna o reprocessamento
     * de evento idempotente.
     */
    origem_evento_id: text("origem_evento_id"),
    importacao_id: text("importacao_id"),
    criada_em: utc("criada_em").notNull().defaultNow(),
  },
  (t) => [
    index("transactions_portfolio_data_idx").on(t.portfolio_id, t.data),
    index("transactions_user_idx").on(t.user_id),
    index("transactions_ticker_idx").on(t.ticker),
    // Impede que o mesmo evento corporativo seja aplicado duas vezes na mesma
    // carteira, mesmo se o consumidor reprocessar.
    uniqueIndex("transactions_evento_uq").on(t.portfolio_id, t.origem_evento_id),
  ],
);

/** Snapshot diario, para o grafico nao recalcular a serie inteira. */
export const snapshots = portfolio.table(
  "snapshots",
  {
    portfolio_id: text("portfolio_id").notNull(),
    user_id: text("user_id").notNull(),
    data: date("data").notNull(),
    valor_bruto: money("valor_bruto").notNull(),
    custo_total: money("custo_total").notNull(),
    resultado_nao_realizado: money("resultado_nao_realizado").notNull(),
    resultado_realizado_acumulado: money("resultado_realizado_acumulado").notNull(),
    proventos_acumulados: money("proventos_acumulados").notNull(),
    /** Fluxo de caixa do dia: aportes positivos, retiradas negativas. */
    fluxo_caixa: money("fluxo_caixa").notNull().default("0"),
    /** Retorno diario do TWR, em fracao. */
    retorno_twr: numeric("retorno_twr", { precision: 18, scale: 10 }),
    base_100: numeric("base_100", { precision: 18, scale: 6 }),
    calculado_em: utc("calculado_em").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.portfolio_id, t.data] }),
    index("snapshots_data_idx").on(t.data),
    index("snapshots_user_idx").on(t.user_id),
  ],
);

export const imports = portfolio.table(
  "imports",
  {
    id: text("id").primaryKey(),
    portfolio_id: text("portfolio_id").notNull(),
    user_id: text("user_id").notNull(),
    formato: text("formato").notNull(),
    nome_arquivo: text("nome_arquivo"),
    linhas_lidas: integer("linhas_lidas").notNull(),
    linhas_aceitas: integer("linhas_aceitas").notNull(),
    linhas_rejeitadas: integer("linhas_rejeitadas").notNull(),
    /** Relatorio de rejeicao: linha, motivo e conteudo original. */
    rejeicoes: text("rejeicoes"),
    duracao_ms: integer("duracao_ms"),
    criada_em: utc("criada_em").notNull().defaultNow(),
  },
  (t) => [index("imports_portfolio_idx").on(t.portfolio_id)],
);

/** Auditoria de acao sensivel. Append-only: nao ha update nem delete. */
export const audit_log = portfolio.table(
  "audit_log",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    acao: text("acao").notNull(),
    recurso: text("recurso"),
    recurso_id: text("recurso_id"),
    detalhe: text("detalhe"),
    ip: text("ip"),
    user_agent: text("user_agent"),
    ocorrido_em: utc("ocorrido_em").notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_user_idx").on(t.user_id, t.ocorrido_em),
    index("audit_log_acao_idx").on(t.acao),
  ],
);
