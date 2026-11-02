/**
 * Processo do alerts (ADR 0012): consome eventos, avalia regras e entrega.
 * Serve so /health, para o orquestrador.
 */
import { createServer } from "node:http";
import webpush from "web-push";
import { criarDb, criarPool } from "@bolsiq/db-core";
import { conectar } from "@bolsiq/messaging";
import {
  canalEmail,
  canalInApp,
  canalPush,
  canalTelegram,
  iniciarWorkerDeAlertas,
  telegramHabilitado,
  type CanalDeEnvio,
} from "@bolsiq/alerts";
import { carregarEnv } from "./config.js";

const env = carregarEnv();
const log = (nivel: string, msg: string, ctx: Record<string, unknown> = {}) =>
  process.stderr.write(
    `${JSON.stringify({ level: nivel, msg, svc: "alerts-worker", ...ctx })}\n`,
  );

const pool = criarPool({ url: env.DATABASE_URL, maxConnections: 6 });
const db = criarDb(pool);
const messaging = await conectar({ servers: env.NATS_URL, name: "alerts-worker" });
await messaging.garantirStream();

const canais: CanalDeEnvio[] = [
  canalInApp((s, d) => messaging.conexao.publish(s, d)),
  canalEmail({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    from: env.SMTP_FROM,
    urlBase: env.APP_URL,
  }),
];

if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  canais.push(canalPush(webpush));
} else {
  log("warn", "VAPID nao configurado: canal push desligado");
}

if (telegramHabilitado(process.env) && env.TELEGRAM_BOT_TOKEN) {
  canais.push(canalTelegram(env.TELEGRAM_BOT_TOKEN));
}

const worker = await iniciarWorkerDeAlertas({ db, messaging, canais, log });
log("info", "alerts-worker no ar", {
  canais: canais.map((c) => c.nome),
  regras: worker.indice.tamanho,
});

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
