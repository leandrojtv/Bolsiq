/**
 * Ponto de entrada. `ROLE` decide o que sobe (ADR 0006).
 */
import { criarDb, criarPool } from "@bolsiq/db-core";
import {
  conectar,
  iniciarLoopDePublicacao,
  type LoopDePublicacao,
  type Messaging,
} from "@bolsiq/messaging";
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
const db = criarDb(pool);

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

let messaging: Messaging | undefined;
let loopDeOutbox: LoopDePublicacao | undefined;
let worker: Worker | undefined;
let encerrando = false;

/**
 * Conecta ao NATS sem bloquear a subida.
 *
 * O serviço não deve deixar de subir porque o barramento está fora: a API de
 * cotações e o health funcionam sem ele. Depois da primeira conexão o próprio
 * cliente reconecta indefinidamente; a lacuna é só o primeiro contato, e é o
 * que esta retentativa cobre.
 */
async function conectarAoNats(): Promise<Messaging | undefined> {
  try {
    const m = await conectar({
      servers: env.NATS_URL,
      name: `market-data-${env.ROLE}`,
    });
    await m.garantirStream();
    return m;
  } catch {
    return undefined;
  }
}

const app = await criarApp({
  env,
  verificarBanco,
  apenasHealth: !servirApiPublica(env.ROLE),
});

if (consumirFila(env.ROLE)) {
  worker = await iniciarWorker(env);
}

await app.listen({ port: env.PORT, host: env.HOST });
app.log.info(
  { role: env.ROLE, apiPublica: servirApiPublica(env.ROLE) },
  "market-data no ar",
);

// A ligação com o NATS acontece depois do listen, para o health responder
// mesmo com o barramento fora.
void (async () => {
  while (!encerrando && !messaging) {
    messaging = await conectarAoNats();

    if (!messaging) {
      app.log.warn({ nats: env.NATS_URL }, "NATS indisponível; tentando de novo em 5s");
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    app.log.info({ nats: env.NATS_URL }, "NATS conectado");

    // A rota /v1/stream já existe desde o listen; agora o repasse começa.
    if (servirApiPublica(env.ROLE)) {
      app.stream.ligar(messaging);
    }

    // O publisher do outbox é trabalho de fundo: roda no worker, não na API.
    if (consumirFila(env.ROLE)) {
      loopDeOutbox = iniciarLoopDePublicacao({
        db,
        publicador: messaging,
        aoFalhar: (erro) => {
          app.log.error({ err: erro }, "falha na rodada de publicação do outbox");
        },
      });
    }
  }
})();

async function encerrar(sinal: string): Promise<void> {
  encerrando = true;
  app.log.info({ sinal }, "encerrando");
  await loopDeOutbox?.parar();
  await app.close();
  await worker?.parar();
  await messaging?.fechar();
  await pool.end();
  process.exit(0);
}

for (const sinal of ["SIGTERM", "SIGINT"] as const) {
  process.on(sinal, () => {
    void encerrar(sinal);
  });
}
