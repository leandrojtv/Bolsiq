-- Marca de recalculo: toda escrita na carteira preenche, o portfolio-worker
-- recalcula os snapshots e limpa. Assim o worker nao varre carteira parada.
ALTER TABLE "portfolio"."portfolios" ADD COLUMN "recalcular_desde" date;
--> statement-breakpoint
-- Indice parcial escrito a mao: o Drizzle nao o conhece e nao o compara.
CREATE INDEX portfolios_recalcular_idx ON portfolio.portfolios (recalcular_desde)
  WHERE recalcular_desde IS NOT NULL;
