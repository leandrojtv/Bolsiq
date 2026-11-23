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
import {
  JOB_INSIGHTS,
  JOB_ROTINA_DIARIA,
  rotinaDeInsights,
  rotinaDiaria,
} from "@bolsiq/finance";
import { conectar } from "@bolsiq/messaging";
import { carregarEnv } from "./config.js";
import { iniciarPainel } from "./painel.js";
import { iniciarImportacao } from "./importacao.js";
import { iniciarRelatorio } from "./relatorio.js";
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

// Bolsiq Financas (ADR 0033): previstos das recorrencias e fechamento de fatura.
const hojeEmSp = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
await boss.createQueue(JOB_ROTINA_DIARIA, {
  name: JOB_ROTINA_DIARIA,
  retryLimit: 3,
  retryDelay: 300,
});
await boss.schedule(JOB_ROTINA_DIARIA, env.FINANCE_ROTINA_CRON, undefined, {
  tz: "America/Sao_Paulo",
});
await boss.work(JOB_ROTINA_DIARIA, async () => {
  const r = await rotinaDiaria(db, hojeEmSp());
  log("info", "rotina diaria do financas", { ...r });
  return r;
});
// Ao subir tambem: um deploy depois do horario nao deixa o dia sem previstos.
await boss.send(JOB_ROTINA_DIARIA, {}, { singletonKey: hojeEmSp() });

// Insights (ADR 0035): o web enfileira { user_id } ao confirmar uma importacao;
// o cron diario, sem usuario, recalcula todos.
await boss.createQueue(JOB_INSIGHTS, {
  name: JOB_INSIGHTS,
  retryLimit: 2,
  retryDelay: 120,
});
await boss.schedule(JOB_INSIGHTS, env.FINANCE_INSIGHTS_CRON, undefined, {
  tz: "America/Sao_Paulo",
});
await boss.work<{ user_id?: string }>(JOB_INSIGHTS, async ([trabalho]) => {
  const r = await rotinaDeInsights(db, hojeEmSp(), trabalho?.data?.user_id);
  log("info", "insights do financas", { ...r });
  return r;
});

// Relatorio mensal do assistente (ADR 0036): opt-in, com a chave do usuario.
await iniciarRelatorio(boss, db, env, hojeEmSp, log);

// Painel geral e alertas do financas (ADR 0037): vigia, foto mensal do
// patrimonio e publicacao do outbox do finance no NATS.
const messaging = await conectar({ servers: env.NATS_URL, name: "portfolio-worker" });
await messaging.garantirStream();
const publicacao = await iniciarPainel(boss, db, env, precos, messaging, hojeEmSp, log);

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
  await publicacao.parar();
  await boss.stop({ graceful: true });
  await messaging.fechar();
  await pool.end();
  process.exit(0);
}
for (const s of ["SIGTERM", "SIGINT"] as const) process.on(s, () => void encerrar());
