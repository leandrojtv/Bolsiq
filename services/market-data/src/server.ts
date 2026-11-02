/**
 * Ponto de entrada. `ROLE` decide o que sobe (ADR 0006).
 */
import { criarApp } from "./app.js";
import { carregarEnv, consumirFila, servirApiPublica } from "./config.js";
import { iniciarWorker, type Worker } from "./worker.js";

const env = carregarEnv();

let worker: Worker | undefined;

if (consumirFila(env.ROLE)) {
  worker = await iniciarWorker(env);
}

// Todo papel serve HTTP, mas o worker serve apenas /v1/health.
const app = await criarApp({ env, apenasHealth: !servirApiPublica(env.ROLE) });

await app.listen({ port: env.PORT, host: env.HOST });
app.log.info(
  { role: env.ROLE, apiPublica: servirApiPublica(env.ROLE) },
  "market-data no ar",
);

async function encerrar(sinal: string): Promise<void> {
  app.log.info({ sinal }, "encerrando");
  await app.close();
  await worker?.parar();
  process.exit(0);
}

for (const sinal of ["SIGTERM", "SIGINT"] as const) {
  process.on(sinal, () => {
    void encerrar(sinal);
  });
}
