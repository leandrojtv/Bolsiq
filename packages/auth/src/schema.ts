import {
  boolean,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Schema `app`: conta do usuario. As tabelas do Better Auth sao criadas pela
 * migration gerada; aqui ficam so as colunas que o app consulta direto.
 */
export const app = pgSchema("app");

const utc = (nome: string) => timestamp(nome, { withTimezone: true, mode: "string" });

export const usuarios = app.table("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  emailVerified: boolean("emailVerified").notNull(),
  twoFactorEnabled: boolean("twoFactorEnabled"),
  createdAt: utc("createdAt").notNull(),
});

/** Watchlist por usuario (antes no localStorage). */
export const watchlist = app.table(
  "watchlist",
  {
    user_id: text("user_id").notNull(),
    ticker: text("ticker").notNull(),
    posicao: integer("posicao").notNull(),
    criada_em: utc("criada_em").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.user_id, t.ticker] }),
    index("watchlist_user_idx").on(t.user_id),
  ],
);
