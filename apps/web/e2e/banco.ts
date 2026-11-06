import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Consulta ao Postgres do compose, para o e2e conferir a tela contra o banco.
 * Pelo `docker compose exec`: o banco do compose nao publica porta no host.
 */
export function consultar(sql: string): string[][] {
  const compose = resolve(import.meta.dirname, "../../../infra/docker/compose.ci.yml");
  const saida = execFileSync(
    "docker",
    [
      "compose",
      "-f",
      compose,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "bolsiq",
      "-d",
      "bolsiq",
      "-tA",
      "-F",
      "|",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  );
  return saida
    .trim()
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => l.split("|"));
}

/** Evento como o market-data publicaria: linha no outbox, o publisher leva ao NATS. */
export function publicarEvento(nome: string, payload: unknown) {
  consultar(
    `insert into market_data.outbox (id, event_name, payload, occurred_at, producer)
     values (gen_random_uuid()::text, '${nome}', '${JSON.stringify(payload)}'::jsonb, now(), 'e2e')`,
  );
}

/** Cotacao como o market-data publicaria: linha no outbox, o publisher leva ao NATS. */
export function publicarCotacao(ticker: string, preco: string) {
  const payload = JSON.stringify({
    ticker,
    price: preco,
    change: "0.00",
    ts: new Date().toISOString(),
  });
  consultar(
    `insert into market_data.outbox (id, event_name, payload, occurred_at, producer)
     values (gen_random_uuid()::text, 'marketdata.quote.updated.v1', '${payload}'::jsonb, now(), 'e2e')`,
  );
}
