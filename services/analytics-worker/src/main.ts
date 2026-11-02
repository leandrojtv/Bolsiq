/**
 * Processo do analytics (ADR 0018): consome eventos do market-data, recalcula
 * indicadores e mantem o espelho do universo. Serve so /health.
 */
import { createServer } from "node:http";
import { criarDb, criarPool } from "@bolsiq/db-core";
import { conectar } from "@bolsiq/messaging";
import { clienteDoMarketData, iniciarWorkerDeAnalytics } from "@bolsiq/analytics";
import { carregarEnv } from "./config.js";

const env = carregarEnv();
const log = (nivel: string, msg: string, ctx: Record<string, unknown> = {}) => {
  if (nivel === "debug") return;
  process.stderr.write(
    `${JSON.stringify({ level: nivel, msg, svc: "analytics-worker", ...ctx })}\n`,
  );
};

const pool = criarPool({
  url: env.DATABASE_URL,
  maxConnections: env.RECALC_CONCURRENCY + 2,
});
const db = criarDb(pool);
const messaging = await conectar({ servers: env.NATS_URL, name: "analytics-worker" });
await messaging.garantirStream();

const worker = await iniciarWorkerDeAnalytics({
  db,
  messaging,
  cliente: clienteDoMarketData(env.MARKET_DATA_URL),
  log,
  concorrencia: env.RECALC_CONCURRENCY,
});
log("info", "analytics-worker no ar", { marketData: env.MARKET_DATA_URL });

const servidor = createServer((req, res) => {
  if (req.url !== "/health") {
    res.writeHead(404).end();
    return;
  }
  void pool
    .query("select 1")
    .then(() => true)
    .catch(() => false)
    .then((bancoOk) => {
      const natsOk = !messaging.conexao.isClosed();
      const ok = bancoOk && natsOk;
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" }).end(
        JSON.stringify({
          status: ok ? "ok" : "degraded",
          checks: { database: bancoOk, nats: natsOk },
        }),
      );
    });
});
servidor.listen(env.PORT, "0.0.0.0");

async function encerrar() {
  servidor.close();
  await worker.parar();
  await messaging.fechar();
  await pool.end();
  process.exit(0);
}
for (const s of ["SIGTERM", "SIGINT"] as const) process.on(s, () => void encerrar());
