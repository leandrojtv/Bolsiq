import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Schema proprio do assistente. Tudo aqui e do usuario: RLS forcada em toda
 * tabela (migration 0001), e o BFF so entra por `comoUsuario` (ADR 0011).
 */
export const assistant = pgSchema("assistant");

const utc = (nome: string) => timestamp(nome, { withTimezone: true, mode: "string" });

export const settings = assistant.table("settings", {
  user_id: text("user_id").primaryKey(),
  /** Nulo: usuario sem provedor proprio (so consentiu, ou usa a chave da plataforma). */
  provedor: text("provedor"),
  modelo: text("modelo"),
  /** AES-256-GCM (`cifrarChave`). Nunca sai do servidor. */
  chave_cifrada: text("chave_cifrada"),
  /** Os 4 ultimos caracteres, para a tela. */
  chave_final: text("chave_final"),
  /** Ollama. */
  base_url: text("base_url"),
  /** Dolares por milhao de tokens, guardados ao escolher o modelo. */
  preco_entrada: numeric("preco_entrada", { precision: 14, scale: 6 }),
  preco_saida: numeric("preco_saida", { precision: 14, scale: 6 }),
  consentimento_em: utc("consentimento_em"),
  /** A importacao com IA tem consentimento proprio: o documento vai ao provedor. */
  consentimento_importacao_em: utc("consentimento_importacao_em"),
  /** Guardar o arquivo original das importacoes com IA. Padrao: nao. */
  guardar_original: boolean("guardar_original").notNull().default(false),
  atualizado_em: utc("atualizado_em").notNull().defaultNow(),
});

export const investorProfiles = assistant.table("investor_profiles", {
  user_id: text("user_id").primaryKey(),
  /** Documento validado por `PerfilDoInvestidor`. */
  perfil: jsonb("perfil").notNull(),
  atualizado_em: utc("atualizado_em").notNull().defaultNow(),
});

export const conversations = assistant.table(
  "conversations",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    titulo: text("titulo").notNull(),
    tokens_entrada: integer("tokens_entrada").notNull().default(0),
    tokens_saida: integer("tokens_saida").notNull().default(0),
    custo_estimado: numeric("custo_estimado", { precision: 14, scale: 6 }),
    criada_em: utc("criada_em").notNull().defaultNow(),
    atualizada_em: utc("atualizada_em").notNull().defaultNow(),
  },
  (t) => [index("conversations_user_idx").on(t.user_id, t.atualizada_em)],
);

export const messages = assistant.table(
  "messages",
  {
    id: text("id").primaryKey(),
    conversation_id: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    user_id: text("user_id").notNull(),
    papel: text("papel").notNull(),
    /** Partes da UIMessage do AI SDK: texto e passos de ferramenta. */
    partes: jsonb("partes").notNull(),
    criada_em: utc("criada_em").notNull().defaultNow(),
  },
  (t) => [index("messages_conversa_idx").on(t.conversation_id, t.criada_em)],
);

/**
 * Consumo por chamada. Sem FK para `conversations`: apagar a conversa nao devolve
 * a cota do dia nem some com o gasto do mes. Sai junto com a conta (LGPD).
 */
export const usage = assistant.table(
  "usage",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    conversation_id: text("conversation_id"),
    provedor: text("provedor").notNull(),
    modelo: text("modelo").notNull(),
    plataforma: boolean("plataforma").notNull().default(false),
    /** `chat` ou `importacao`: o limite de mensagens conta so o chat. */
    origem: text("origem").notNull().default("chat"),
    tokens_entrada: integer("tokens_entrada").notNull(),
    tokens_saida: integer("tokens_saida").notNull(),
    custo_estimado: numeric("custo_estimado", { precision: 14, scale: 6 }),
    criado_em: utc("criado_em").notNull().defaultNow(),
  },
  (t) => [index("usage_user_idx").on(t.user_id, t.criado_em)],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * Importacao com IA: o cache e o relatorio. A chave do cache e o hash do arquivo,
 * a versao do prompt e o modelo; o mesmo arquivo nao vai ao provedor duas vezes.
 * O arquivo original so fica com `guardar_original` (LGPD: sai com a conta).
 */
export const extractions = assistant.table(
  "extractions",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    hash: text("hash").notNull(),
    versao_prompt: text("versao_prompt").notNull(),
    provedor: text("provedor").notNull(),
    modelo: text("modelo").notNull(),
    nome_arquivo: text("nome_arquivo").notNull(),
    tipo_arquivo: text("tipo_arquivo").notNull(),
    /** O JSON que o modelo devolveu, ja juntado das partes. */
    extraido: jsonb("extraido").notNull(),
    /** Validacao e conciliacao, para o historico. */
    relatorio: jsonb("relatorio"),
    tokens_entrada: integer("tokens_entrada").notNull(),
    tokens_saida: integer("tokens_saida").notNull(),
    custo_estimado: numeric("custo_estimado", { precision: 14, scale: 6 }),
    original: bytea("original"),
    original_mime: text("original_mime"),
    criado_em: utc("criado_em").notNull().defaultNow(),
    confirmado_em: utc("confirmado_em"),
  },
  (t) => [
    uniqueIndex("extractions_cache_idx").on(
      t.user_id,
      t.hash,
      t.versao_prompt,
      t.provedor,
      t.modelo,
    ),
    index("extractions_user_idx").on(t.user_id, t.criado_em),
  ],
);
