/**
 * Processo do portfolio: snapshot diario das carteiras.
 *
 * - Job agendado (pg-boss) no fechamento marca todas as carteiras.
 * - O laco recalcula as carteiras marcadas: pelo job ou pelo app, a cada
 *   transacao nova, importacao ou exclusao.
 */
import { createServer } from "node:http";
import PgBoss from "pg-boss";
import { criarDb, criarPool } from "@bolsiq/db-core";
import { carregarEnv } from "./config.js";
import { iniciarImportacao } from "./importacao.js";
import {
  clienteDePrecos,
  desmarcar,
  marcadas,
  marcarTodas,
  recalcular,
} from "./recalculo.js";

const env = carregarEnv();
const log = (nivel: string, msg: string, ctx: Record<string, unknown> = {}) =>
  process.stderr.write(
    `${JSON.stringify({ level: nivel, msg, svc: "portfolio-worker", ...ctx })}\n`,
  );

const pool = criarPool({ url: env.DATABASE_URL, maxConnections: 4 });
const db = criarDb(pool);
const precos = clienteDePrecos(env.MARKET_DATA_URL, env.MARKET_DATA_API_KEY);

const JOB = "portfolio.snapshot-diario";
const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss" });
boss.on("error", (e) => log("error", "pg-boss", { erro: String(e) }));
await boss.start();
await boss.createQueue(JOB, {
  name: JOB,
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
});
await boss.schedule(JOB, env.SNAPSHOT_CRON, undefined, { tz: "America/Sao_Paulo" });
await boss.work(JOB, async () => {
  const total = await marcarTodas(db);
  log("info", "carteiras marcadas para o snapshot do dia", { total });
  return { total };
});
await iniciarImportacao(boss, db, env, log);

let ultimoCiclo = Date.now();
let parado = false;
async function ciclo() {
  while (!parado) {
    try {
      for (const c of await marcadas(db)) {
        const inicio = Date.now();
        const dias = await recalcular(db, precos, c);
        if (c.desde) await desmarcar(db, c.id, c.desde);
        log("info", "snapshots recalculados", {
          carteira: c.id,
          dias,
          ms: Date.now() - inicio,
        });
      }
    } catch (erro) {
      log("error", "recalculo falhou", { erro: String(erro) });
    }
    ultimoCiclo = Date.now();
    await new Promise((r) => setTimeout(r, env.RECALCULO_MS));
  }
}
void ciclo();
log("info", "portfolio-worker no ar", { cron: env.SNAPSHOT_CRON });

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
      // Laco parado ha mais de um minuto e falha, nao so lentidao.
      const lacoOk = Date.now() - ultimoCiclo < 60_000 + env.RECALCULO_MS;
      const ok = bancoOk && lacoOk;
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" }).end(
        JSON.stringify({
          status: ok ? "ok" : "degraded",
          checks: { database: bancoOk, loop: lacoOk },
        }),
      );
    });
});
servidor.listen(env.PORT, "0.0.0.0");

async function encerrar() {
  parado = true;
  servidor.close();
  await boss.stop({ graceful: true });
  await pool.end();
  process.exit(0);
}
for (const s of ["SIGTERM", "SIGINT"] as const) process.on(s, () => void encerrar());
