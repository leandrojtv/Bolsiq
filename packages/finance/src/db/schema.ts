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

/** Cartao de credito. A fatura sai do ciclo (dia de fechamento e de vencimento). */
export const cards = finance.table(
  "cards",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    nome: text("nome").notNull(),
    instituicao: text("instituicao"),
    /** Ultimos 4 digitos: sugerem o cartao a partir do ACCTID do OFX. */
    final: text("final"),
    bandeira: text("bandeira"),
    cor: text("cor"),
    limite: dinheiro("limite"),
    dia_fechamento: integer("dia_fechamento").notNull(),
    dia_vencimento: integer("dia_vencimento").notNull(),
    /** Conta que costuma pagar a fatura. */
    account_id: text("account_id"),
    arquivado: boolean("arquivado").notNull().default(false),
    criado_em: utc("criado_em").notNull().defaultNow(),
  },
  (t) => [
    index("cards_user_idx").on(t.user_id),
    unique("cards_user_id_uq").on(t.user_id, t.id),
    uniqueIndex("cards_user_nome_uq").on(t.user_id, t.nome),
    foreignKey({
      name: "cards_account_fk",
      columns: [t.user_id, t.account_id],
      foreignColumns: [accounts.user_id, accounts.id],
    }),
    check("cards_dia_fechamento_ck", sql`${t.dia_fechamento} between 1 and 31`),
    check("cards_dia_vencimento_ck", sql`${t.dia_vencimento} between 1 and 31`),
    check("cards_final_ck", sql`${t.final} is null or ${t.final} ~ '^[0-9]{4}$'`),
  ],
);

/** Fatura do cartao, identificada pelo vencimento. Criada sob demanda. */
export const statements = finance.table(
  "statements",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    card_id: text("card_id").notNull(),
    vencimento: dia("vencimento").notNull(),
    fechamento: dia("fechamento").notNull(),
    /** Primeiro dia do mes do vencimento. */
    competencia: dia("competencia").notNull(),
    /** aberta | fechada | paga */
    status: text("status").notNull().default("aberta"),
    /** Total que o banco informou (LEDGERBAL da importacao); nulo ate la. */
    total_informado: dinheiro("total_informado"),
    /** Lado da conta do pagamento (transferencia), previsto ou realizado. */
    pagamento_id: text("pagamento_id"),
    criada_em: utc("criada_em").notNull().defaultNow(),
  },
  (t) => [
    unique("statements_user_id_uq").on(t.user_id, t.id),
    // Inclui o card_id: a FK composta do lancamento garante que a fatura e do
    // mesmo cartao.
    unique("statements_user_card_id_uq").on(t.user_id, t.card_id, t.id),
    uniqueIndex("statements_card_vencimento_uq").on(t.user_id, t.card_id, t.vencimento),
    foreignKey({
      name: "statements_card_fk",
      columns: [t.user_id, t.card_id],
      foreignColumns: [cards.user_id, cards.id],
    }),
    check("statements_ciclo_ck", sql`${t.fechamento} <= ${t.vencimento}`),
    check("statements_status_ck", sql`${t.status} in ('aberta', 'fechada', 'paga')`),
  ],
);

export const transactions = finance.table(
  "transactions",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    /** Conta ou cartao: exatamente um dos dois. */
    account_id: text("account_id"),
    card_id: text("card_id"),
    /** Fatura do cartao; obrigatoria quando ha card_id. */
    statement_id: text("statement_id"),
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
    /** Recorrencia que gerou o previsto. */
    recurrence_id: text("recurrence_id"),
    /** FITID do OFX: deduplicacao principal, por conta ou cartao. */
    fitid: text("fitid"),
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
    foreignKey({
      name: "transactions_card_fk",
      columns: [t.user_id, t.card_id],
      foreignColumns: [cards.user_id, cards.id],
    }),
    foreignKey({
      name: "transactions_statement_fk",
      columns: [t.user_id, t.card_id, t.statement_id],
      foreignColumns: [statements.user_id, statements.card_id, statements.id],
    }),
    index("transactions_account_data_idx").on(t.account_id, t.data),
    index("transactions_card_data_idx").on(t.card_id, t.data),
    index("transactions_statement_idx").on(t.statement_id),
    index("transactions_importacao_idx").on(t.importacao_id),
    // Idempotencia do job: uma ocorrencia por recorrencia e data.
    uniqueIndex("transactions_recorrencia_data_uq")
      .on(t.recurrence_id, t.data)
      .where(sql`${t.recurrence_id} is not null`),
    uniqueIndex("transactions_account_fitid_uq")
      .on(t.user_id, t.account_id, t.fitid)
      .where(sql`${t.fitid} is not null and ${t.account_id} is not null`),
    uniqueIndex("transactions_card_fitid_uq")
      .on(t.user_id, t.card_id, t.fitid)
      .where(sql`${t.fitid} is not null and ${t.card_id} is not null`),
    check(
      "transactions_destino_ck",
      sql`(${t.account_id} is null) <> (${t.card_id} is null) and (${t.card_id} is null) = (${t.statement_id} is null)`,
    ),
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

/**
 * Lancamento recorrente (salario, aluguel, assinatura). O job diario gera os
 * previstos ate 90 dias a frente.
 */
export const recurrences = finance.table(
  "recurrences",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    /** receita | despesa */
    tipo: text("tipo").notNull(),
    descricao: text("descricao").notNull(),
    valor: dinheiro("valor").notNull(),
    category_id: text("category_id"),
    account_id: text("account_id"),
    card_id: text("card_id"),
    /** mensal | semanal | anual */
    frequencia: text("frequencia").notNull(),
    /** Mensal e anual: dia do mes (1 a 31). Semanal: dia da semana (1 = segunda, 7 = domingo). */
    dia: integer("dia").notNull(),
    inicio: dia("inicio").notNull(),
    /** Nulo: sem fim. */
    fim: dia("fim"),
    /** O previsto usa o ultimo valor realizado (conta de luz). */
    valor_variavel: boolean("valor_variavel").notNull().default(false),
    ativa: boolean("ativa").notNull().default(true),
    criada_em: utc("criada_em").notNull().defaultNow(),
  },
  (t) => [
    index("recurrences_user_idx").on(t.user_id),
    unique("recurrences_user_id_uq").on(t.user_id, t.id),
    foreignKey({
      name: "recurrences_account_fk",
      columns: [t.user_id, t.account_id],
      foreignColumns: [accounts.user_id, accounts.id],
    }),
    foreignKey({
      name: "recurrences_card_fk",
      columns: [t.user_id, t.card_id],
      foreignColumns: [cards.user_id, cards.id],
    }),
    foreignKey({
      name: "recurrences_category_fk",
      columns: [t.user_id, t.category_id],
      foreignColumns: [categories.user_id, categories.id],
    }),
    check("recurrences_tipo_ck", sql`${t.tipo} in ('receita', 'despesa')`),
    check(
      "recurrences_frequencia_ck",
      sql`${t.frequencia} in ('mensal', 'semanal', 'anual')`,
    ),
    check(
      "recurrences_dia_ck",
      sql`${t.dia} between 1 and (case when ${t.frequencia} = 'semanal' then 7 else 31 end)`,
    ),
    check("recurrences_valor_ck", sql`${t.valor} > 0`),
    check(
      "recurrences_destino_ck",
      sql`(${t.account_id} is null) <> (${t.card_id} is null)`,
    ),
    check("recurrences_periodo_ck", sql`${t.fim} is null or ${t.fim} >= ${t.inicio}`),
  ],
);

/**
 * Planejamento mensal (orcamento): quanto se pretende receber e gastar por
 * categoria. Nao cria nem altera lancamento; a tela compara com o realizado.
 */
export const budget_items = finance.table(
  "budget_items",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    /** Primeiro dia do mes planejado. */
    competencia: dia("competencia").notNull(),
    category_id: text("category_id").notNull(),
    descricao: text("descricao"),
    valor: dinheiro("valor").notNull(),
    fixo: boolean("fixo").notNull().default(false),
    /** Item puxado de uma recorrencia: copiar de novo nao duplica. */
    recurrence_id: text("recurrence_id"),
    criado_em: utc("criado_em").notNull().defaultNow(),
  },
  (t) => [
    index("budget_items_user_mes_idx").on(t.user_id, t.competencia),
    // FK composta; a categoria apagada leva o item junto.
    foreignKey({
      name: "budget_items_category_fk",
      columns: [t.user_id, t.category_id],
      foreignColumns: [categories.user_id, categories.id],
    }).onDelete("cascade"),
    // Copiar o mes anterior de novo nao duplica: mesma categoria e descricao.
    unique("budget_items_mes_item_uq")
      .on(t.user_id, t.competencia, t.category_id, t.descricao)
      .nullsNotDistinct(),
    check("budget_items_valor_ck", sql`${t.valor} >= 0`),
    check(
      "budget_items_competencia_ck",
      sql`${t.competencia} = date_trunc('month', ${t.competencia})::date`,
    ),
  ],
);

/** Importacao de extrato ou fatura. As linhas ficam em `import_rows`. */
export const imports = finance.table(
  "imports",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    /** ofx por enquanto; texto livre para os proximos formatos. */
    origem: text("origem").notNull(),
    /** conta | cartao */
    alvo: text("alvo").notNull(),
    account_id: text("account_id"),
    card_id: text("card_id"),
    statement_id: text("statement_id"),
    arquivo_nome: text("arquivo_nome").notNull(),
    /** revisao | confirmada | cancelada | desfeita */
    status: text("status").notNull().default("revisao"),
    /** BANKID/ORG e ACCTID: sugerem o destino na proxima importacao. */
    banco: text("banco"),
    conta_externa: text("conta_externa"),
    inicio: dia("inicio"),
    fim: dia("fim"),
    saldo_informado: dinheiro("saldo_informado"),
    saldo_data: dia("saldo_data"),
    /** linhas, selecionadas, total, duplicadas, sem_categoria, gravadas. */
    totais: jsonb("totais").notNull().default({}),
    criada_em: utc("criada_em").notNull().defaultNow(),
    confirmada_em: utc("confirmada_em"),
  },
  (t) => [
    index("imports_user_idx").on(t.user_id, t.criada_em),
    unique("imports_user_id_uq").on(t.user_id, t.id),
    foreignKey({
      name: "imports_account_fk",
      columns: [t.user_id, t.account_id],
      foreignColumns: [accounts.user_id, accounts.id],
    }),
    foreignKey({
      name: "imports_card_fk",
      columns: [t.user_id, t.card_id],
      foreignColumns: [cards.user_id, cards.id],
    }),
    foreignKey({
      name: "imports_statement_fk",
      columns: [t.user_id, t.card_id, t.statement_id],
      foreignColumns: [statements.user_id, statements.card_id, statements.id],
    }),
    check("imports_alvo_ck", sql`${t.alvo} in ('conta', 'cartao')`),
    check(
      "imports_status_ck",
      sql`${t.status} in ('revisao', 'confirmada', 'cancelada', 'desfeita')`,
    ),
    check(
      "imports_destino_ck",
      sql`(${t.alvo} = 'conta' and ${t.account_id} is not null and ${t.card_id} is null and ${t.statement_id} is null) or (${t.alvo} = 'cartao' and ${t.account_id} is null and ${t.card_id} is not null and ${t.statement_id} is not null)`,
    ),
  ],
);

/** Linha proposta: o que o arquivo trouxe, o que foi detectado e o que o usuario mudou. */
export const import_rows = finance.table(
  "import_rows",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    import_id: text("import_id").notNull(),
    ordem: integer("ordem").notNull(),
    arquivo: integer("arquivo").notNull().default(0),
    // Detectado
    fitid: text("fitid"),
    trntype: text("trntype"),
    data: dia("data").notNull(),
    valor: dinheiro("valor").notNull(),
    /** receita | despesa, do sinal do valor no arquivo. */
    tipo: text("tipo").notNull(),
    descricao_original: text("descricao_original").notNull(),
    descricao_normalizada: text("descricao_normalizada").notNull(),
    parcela_atual: integer("parcela_atual"),
    parcela_total: integer("parcela_total"),
    hash_dedupe: text("hash_dedupe").notNull(),
    /** nova | ja_importada | possivel_duplicata */
    situacao: text("situacao").notNull(),
    /** Lancamento ja gravado que esta linha repete ou parece repetir. */
    duplicata_de: text("duplicata_de"),
    categoria_detectada: text("categoria_detectada"),
    /** regra | historico | nenhuma */
    origem_categoria: text("origem_categoria").notNull().default("nenhuma"),
    regra_id: text("regra_id"),
    // Escolhas do usuario
    selecionada: boolean("selecionada").notNull(),
    /** importar | ignorar | conciliar (liga ao `duplicata_de` sem gravar de novo). */
    acao: text("acao").notNull(),
    category_id: text("category_id"),
    categoria_editada: boolean("categoria_editada").notNull().default(false),
    /** Contrapartida quando marcada como transferencia: conta ou cartao. */
    transferencia_conta_id: text("transferencia_conta_id"),
    transferencia_cartao_id: text("transferencia_cartao_id"),
    /** Divisao em duas categorias: [{category_id, valor}], somando o valor. */
    divisoes: jsonb("divisoes"),
    /** Lancamento(s) gravados na confirmacao. */
    transaction_id: text("transaction_id"),
  },
  (t) => [
    index("import_rows_import_idx").on(t.import_id, t.ordem),
    foreignKey({
      name: "import_rows_import_fk",
      columns: [t.user_id, t.import_id],
      foreignColumns: [imports.user_id, imports.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "import_rows_category_fk",
      columns: [t.user_id, t.category_id],
      foreignColumns: [categories.user_id, categories.id],
    }),
    check("import_rows_tipo_ck", sql`${t.tipo} in ('receita', 'despesa')`),
    check(
      "import_rows_situacao_ck",
      sql`${t.situacao} in ('nova', 'ja_importada', 'possivel_duplicata')`,
    ),
    check("import_rows_acao_ck", sql`${t.acao} in ('importar', 'ignorar', 'conciliar')`),
    check("import_rows_valor_ck", sql`${t.valor} > 0`),
  ],
);

/** Regra de categorizacao. A do usuario vence a aprendida. */
export const categorization_rules = finance.table(
  "categorization_rules",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    padrao: text("padrao").notNull(),
    /** contem | comeca_com | regex */
    modo: text("modo").notNull(),
    category_id: text("category_id").notNull(),
    /** Menor numero primeiro. */
    prioridade: integer("prioridade").notNull().default(100),
    /** usuario | aprendida */
    origem: text("origem").notNull().default("usuario"),
    vezes_aplicada: integer("vezes_aplicada").notNull().default(0),
    criada_em: utc("criada_em").notNull().defaultNow(),
  },
  (t) => [
    index("categorization_rules_user_idx").on(t.user_id, t.prioridade),
    uniqueIndex("categorization_rules_user_padrao_uq").on(t.user_id, t.modo, t.padrao),
    foreignKey({
      name: "categorization_rules_category_fk",
      columns: [t.user_id, t.category_id],
      foreignColumns: [categories.user_id, categories.id],
    }).onDelete("cascade"),
    check(
      "categorization_rules_modo_ck",
      sql`${t.modo} in ('contem', 'comeca_com', 'regex')`,
    ),
    check("categorization_rules_origem_ck", sql`${t.origem} in ('usuario', 'aprendida')`),
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
