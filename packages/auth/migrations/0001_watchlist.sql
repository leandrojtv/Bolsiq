-- Watchlist por usuario: antes no localStorage, migra no primeiro login.
CREATE TABLE app.watchlist (
  user_id text NOT NULL,
  ticker text NOT NULL,
  posicao integer NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ticker)
);
--> statement-breakpoint
CREATE INDEX watchlist_user_idx ON app.watchlist (user_id);
