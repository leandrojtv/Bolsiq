/**
 * Ponto de entrada. `ROLE` decide o que sobe (ADR 0006).
 */
import { criarPool } from "@bolsiq/db-core";
import { criarApp } from "./app.js";
import { carregarEnv, consumirFila, servirApiPublica } from "./config.js";
import { iniciarWorker, type Worker } from "./worker.js";

const env = carregarEnv();

/** A sonda tem de responder rápido: health lento vira health inútil. */
const SONDA_TIMEOUT_MS = 2000;

const pool = criarPool({
  url: env.DATABASE_URL,
  maxConnections: servirApiPublica(env.ROLE) ? 10 : 4,
});

/**
 * Sonda real do banco: um `select 1` com prazo.
 *
 * O prazo importa tanto quanto a consulta. Sem ele, um Postgres que aceita a
 * conexão mas não responde deixaria o health pendurado, e um health pendurado
 * é indistinguível de um health caído para quem tem timeout — mas pior, porque
 * prende uma conexão do pool a cada tentativa.
 */
async function verificarBanco(): Promise<boolean> {
  const prazo = new Promise<never>((_, rejeitar) => {
    const temporizador = setTimeout(
      () => rejeitar(new Error("timeout na sonda do banco")),
      SONDA_TIMEOUT_MS,
    );
    // unref para a sonda não segurar o processo no encerramento.
    temporizador.unref();
  });

  try {
    await Promise.race([pool.query("select 1"), prazo]);
    return true;
  } catch {
    return false;
  }
}

let worker: Worker | undefined;

if (consumirFila(env.ROLE)) {
  worker = await iniciarWorker(env);
}

// Todo papel serve HTTP, mas o worker serve apenas /v1/health.
const app = await criarApp({
  env,
  verificarBanco,
  apenasHealth: !servirApiPublica(env.ROLE),
});

await app.listen({ port: env.PORT, host: env.HOST });
app.log.info(
  { role: env.ROLE, apiPublica: servirApiPublica(env.ROLE) },
  "market-data no ar",
);

async function encerrar(sinal: string): Promise<void> {
  app.log.info({ sinal }, "encerrando");
  await app.close();
  await worker?.parar();
  await pool.end();
  process.exit(0);
}

for (const sinal of ["SIGTERM", "SIGINT"] as const) {
  process.on(sinal, () => {
    void encerrar(sinal);
  });
}
