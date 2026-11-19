import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Schema proprio do Bolsiq Financas (ADR 0031). Nao le nem faz join com
 * `portfolio`, `app`, `analytics` ou `market_data`.
 *
 * `user_id` e redundante em toda tabela pelo mesmo motivo do portfolio: a
 * politica de RLS compara uma coluna indexada da propria linha, sem
 * subconsulta.
 */
export const finance = pgSchema("finance");

const utc = (nome: string) => timestamp(nome, { withTimezone: true, mode: "string" });
const dinheiro = (nome: string) => numeric(nome, { precision: 18, scale: 2 });
const dia = (nome: string) => date(nome, { mode: "string" });

export const accounts = finance.table(
  "accounts",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    nome: text("nome").notNull(),
    /** corrente | poupanca | carteira | beneficio | caixa_corretora */
    tipo: text("tipo").notNull(),
    instituicao: text("instituicao"),
    /** Saldo no inicio do dia `data_saldo_inicial`. */
    saldo_inicial: dinheiro("saldo_inicial").notNull().default("0"),
    data_saldo_inicial: dia("data_saldo_inicial").notNull(),
    cor: text("cor"),
    arquivada: boolean("arquivada").notNull().default(false),
    criada_em: utc("criada_em").notNull().defaultNow(),
  },
  (t) => [
    index("accounts_user_idx").on(t.user_id),
    // Alvo das FKs compostas: lancamento so referencia conta do mesmo usuario.
    unique("accounts_user_id_uq").on(t.user_id, t.id),
    uniqueIndex("accounts_user_nome_uq").on(t.user_id, t.nome),
    check(
      "accounts_tipo_ck",
      sql`${t.tipo} in ('corrente', 'poupanca', 'carteira', 'beneficio', 'caixa_corretora')`,
    ),
  ],
);

export const categories = finance.table(
  "categories",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    parent_id: text("parent_id"),
    nome: text("nome").notNull(),
    /** receita | despesa */
    natureza: text("natureza").notNull(),
    /** fixo | variavel */
    tipo_custo: text("tipo_custo").notNull().default("variavel"),
    essencial: boolean("essencial").notNull().default(false),
    cor: text("cor"),
    icone: text("icone"),
    /** Categoria de que os insights dependem: nao se apaga nem troca de natureza. */
    sistema: boolean("sistema").notNull().default(false),
    arquivada: boolean("arquivada").notNull().default(false),
  },
  (t) => [
    index("categories_user_idx").on(t.user_id),
    unique("categories_user_id_uq").on(t.user_id, t.id),
    // FK composta com o dono: a checagem de FK ignora a RLS, entao sem o
    // user_id na chave daria para apontar para a categoria de outro usuario.
    foreignKey({
      name: "categories_parent_fk",
      columns: [t.user_id, t.parent_id],
      foreignColumns: [t.user_id, t.id],
    }),
    // NULLS NOT DISTINCT: duas raizes com o mesmo nome colidem, e e isso que
    // torna a semeadura idempotente com ON CONFLICT DO NOTHING.
    unique("categories_user_pai_nome_uq")
      .on(t.user_id, t.parent_id, t.nome)
      .nullsNotDistinct(),
    check("categories_natureza_ck", sql`${t.natureza} in ('receita', 'despesa')`),
    check("categories_tipo_custo_ck", sql`${t.tipo_custo} in ('fixo', 'variavel')`),
  ],
);

export const transactions = finance.table(
  "transactions",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    account_id: text("account_id").notNull(),
    /** receita | despesa | transferencia */
    tipo: text("tipo").notNull(),
    /** Sempre positivo: o sinal sai do tipo e, na transferencia, do sentido. */
    valor: dinheiro("valor").notNull(),
    data: dia("data").notNull(),
    /** Primeiro dia do mes a que o lancamento pertence. */
    competencia: dia("competencia").notNull(),
    descricao: text("descricao").notNull(),
    descricao_normalizada: text("descricao_normalizada").notNull(),
    /** Ao apagar a categoria, a operacao zera esta coluna antes (FK composta). */
    category_id: text("category_id"),
    /** previsto | realizado | conciliado */
    status: text("status").notNull().default("realizado"),
    /**
     * Outro lado da transferencia. Sem FK: os dois lados sao gravados na mesma
     * transacao, um apontando para o outro (ADR 0031).
     */
    transferencia_par_id: text("transferencia_par_id"),
    /** saida | entrada, so em transferencia. */
    transferencia_sentido: text("transferencia_sentido"),
    observacao: text("observacao"),
    importacao_id: text("importacao_id"),
    hash_dedupe: text("hash_dedupe"),
    criada_em: utc("criada_em").notNull().defaultNow(),
    atualizada_em: utc("atualizada_em").notNull().defaultNow(),
  },
  (t) => [
    index("transactions_user_data_idx").on(t.user_id, t.data),
    foreignKey({
      name: "transactions_account_fk",
      columns: [t.user_id, t.account_id],
      foreignColumns: [accounts.user_id, accounts.id],
    }),
    foreignKey({
      name: "transactions_category_fk",
      columns: [t.user_id, t.category_id],
      foreignColumns: [categories.user_id, categories.id],
    }),
    index("transactions_account_data_idx").on(t.account_id, t.data),
    index("transactions_category_idx").on(t.category_id),
    index("transactions_user_competencia_idx").on(t.user_id, t.competencia),
    uniqueIndex("transactions_user_hash_uq")
      .on(t.user_id, t.hash_dedupe)
      .where(sql`${t.hash_dedupe} is not null`),
    check(
      "transactions_tipo_ck",
      sql`${t.tipo} in ('receita', 'despesa', 'transferencia')`,
    ),
    check(
      "transactions_status_ck",
      sql`${t.status} in ('previsto', 'realizado', 'conciliado')`,
    ),
    check("transactions_valor_ck", sql`${t.valor} > 0`),
    check(
      "transactions_competencia_ck",
      sql`${t.competencia} = date_trunc('month', ${t.competencia})::date`,
    ),
    check(
      "transactions_transferencia_ck",
      sql`(${t.tipo} = 'transferencia') = (${t.transferencia_sentido} is not null and ${t.transferencia_par_id} is not null) and (${t.transferencia_sentido} is null or ${t.transferencia_sentido} in ('saida', 'entrada'))`,
    ),
  ],
);

/** Auditoria de acao sensivel. Append-only: nao ha update nem delete. */
export const audit_log = finance.table(
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

/**
 * Outbox do modulo (ADR 0008), mesmas colunas de `tabelaDeOutbox` do db-core.
 * Publicado no NATS como `finance.*` quando o primeiro evento existir.
 */
export const outbox = finance.table(
  "outbox",
  {
    id: text("id").primaryKey(),
    event_name: text("event_name").notNull(),
    payload: jsonb("payload").notNull(),
    occurred_at: utc("occurred_at").notNull(),
    producer: text("producer").notNull(),
    created_at: utc("created_at").notNull().defaultNow(),
    published_at: utc("published_at"),
    attempts: integer("attempts").notNull().default(0),
    last_error: text("last_error"),
    dead_at: utc("dead_at"),
  },
  (t) => [
    index("outbox_pendente_idx")
      .on(t.created_at)
      .where(sql`published_at IS NULL AND dead_at IS NULL`),
    index("outbox_event_name_idx").on(t.event_name),
  ],
);
