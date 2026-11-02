import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { and, count, eq } from "drizzle-orm";
import { Pool } from "pg";
import { criarDb, type Db } from "@bolsiq/db-core";
import {
  conectar,
  envelopeDaLinha,
  linhaDeOutbox,
  type Messaging,
} from "@bolsiq/messaging";
import { alertRules, deliveries, notifications } from "../db/schema.js";
import { iniciarWorkerDeAlertas, type WorkerDeAlertas } from "../worker.js";
import { canalInApp } from "../canais/inapp.js";

const HOST = process.env.TEST_HOST ?? "127.0.0.1";

let pg: StartedTestContainer;
let nats: StartedTestContainer;
let pool: Pool;
let db: Db;
let messaging: Messaging;

async function esperar(cond: () => Promise<boolean>, ms = 15_000): Promise<number> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cond()) return Date.now() - t0;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`condicao nao satisfeita em ${ms}ms`);
}

function cotacao(ticker: string, price: string) {
  return envelopeDaLinha(
    linhaDeOutbox({
      name: "marketdata.quote.updated.v1",
      payload: { ticker, price, change: "1.00", ts: "2026-11-02T15:00:00Z" },
      producer: "teste",
    }),
  );
}

async function notificacoesDa(regra: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(notifications)
    .where(eq(notifications.rule_id, regra));
  return r?.n ?? 0;
}

async function criarRegra(id: string, ticker: string, valor: string) {
  await db.insert(alertRules).values({
    id,
    user_id: "u1",
    tipo: "preco_acima",
    ticker,
    params: { valor },
    canais: ["inapp"],
    cooldown_segundos: 0,
  });
}

function iniciar(): Promise<WorkerDeAlertas> {
  return iniciarWorkerDeAlertas({
    db,
    messaging,
    canais: [canalInApp((s, d) => messaging.conexao.publish(s, d))],
    intervaloEntregaMs: 100,
    intervaloRecargaMs: 200,
    log: (nivel, msg, ctx) => {
      if (nivel === "error") console.error(`[alerts] ${msg}`, JSON.stringify(ctx));
    },
  });
}

beforeAll(async () => {
  [pg, nats] = await Promise.all([
    new GenericContainer("timescale/timescaledb-ha:pg17")
      .withEnvironment({ POSTGRES_USER: "u", POSTGRES_PASSWORD: "p", POSTGRES_DB: "ci" })
      .withExposedPorts(5432)
      // A imagem sobe um Postgres temporario para o init e reinicia: a porta
      // abre antes de o banco aceitar conexao ("the database system is
      // starting up"). O temporario so escuta no socket, entao o pg_isready
      // por TCP so passa no servidor definitivo.
      .withWaitStrategy(Wait.forSuccessfulCommand("pg_isready -h 127.0.0.1 -p 5432"))
      .withStartupTimeout(120_000)
      .start(),
    new GenericContainer("nats:2-alpine")
      .withCommand(["-js"])
      .withExposedPorts(4222)
      .start(),
  ]);

  pool = new Pool({
    connectionString: `postgres://u:p@${HOST}:${pg.getMappedPort(5432)}/ci`,
    max: 5,
  });
  const pasta = resolve(import.meta.dirname, "../../migrations");
  for (const arq of readdirSync(pasta)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    for (const bloco of readFileSync(resolve(pasta, arq), "utf8").split(
      "--> statement-breakpoint",
    )) {
      if (bloco.trim()) await pool.query(bloco);
    }
  }
  db = criarDb(pool);

  messaging = await conectar({
    servers: `nats://${HOST}:${nats.getMappedPort(4222)}`,
    name: "teste-alerts",
  });
  await messaging.garantirStream();
}, 180_000);

afterAll(async () => {
  await messaging?.fechar().catch(() => undefined);
  await pool?.end().catch(() => undefined);
  await Promise.all([pg?.stop(), nats?.stop()].map((p) => p?.catch(() => undefined)));
});

describe("worker de alertas", () => {
  it("alerta de preco dispara em ate 5 s apos a cotacao", async () => {
    await criarRegra("lat", "PETR4", "40.00");
    const w = await iniciar();
    try {
      const t0 = Date.now();
      await messaging.publicar(cotacao("PETR4", "41.00"));
      await esperar(async () => (await notificacoesDa("lat")) === 1);
      const latencia = Date.now() - t0;
      console.log(`[alerts] latencia cotacao -> notificacao: ${latencia} ms`);
      expect(latencia).toBeLessThan(5000);

      // E a entrega in-app sai sem intervencao.
      await esperar(async () => {
        const [d] = await db
          .select({ status: deliveries.status })
          .from(deliveries)
          .innerJoin(notifications, eq(notifications.id, deliveries.notification_id))
          .where(eq(notifications.rule_id, "lat"));
        return d?.status === "enviada";
      });
    } finally {
      await w.parar();
    }
  });

  it("evento publicado com o worker parado e processado ao reiniciar, uma vez so", async () => {
    await criarRegra("rein", "VALE3", "60.00");
    const a = await iniciar();
    await a.parar();

    // Worker fora do ar: o evento fica no stream, no consumidor duravel.
    await messaging.publicar(cotacao("VALE3", "61.00"));
    await new Promise((r) => setTimeout(r, 500));
    expect(await notificacoesDa("rein")).toBe(0);

    const b = await iniciar();
    try {
      await esperar(async () => (await notificacoesDa("rein")) === 1);
      // Margem para uma duplicata aparecer, se houvesse.
      await new Promise((r) => setTimeout(r, 1500));
      expect(await notificacoesDa("rein")).toBe(1);
    } finally {
      await b.parar();
    }
  });

  it("a mesma cotacao entregue duas vezes nao duplica a notificacao", async () => {
    // Mesmo envelope, dois Nats-Msg-Id: a deduplicacao do broker nao pega,
    // e o que protege e processed_events mais o indice unico (rule_id, event_id).
    await criarRegra("dup", "ITUB4", "30.00");
    const w = await iniciar();
    try {
      const env = cotacao("ITUB4", "31.00");
      const bytes = new TextEncoder().encode(JSON.stringify(env));
      await messaging.js.publish(env.name, bytes, { msgID: "uma" });
      await messaging.js.publish(env.name, bytes, { msgID: "outra" });

      await esperar(async () => (await notificacoesDa("dup")) >= 1);
      await new Promise((r) => setTimeout(r, 1500));
      expect(await notificacoesDa("dup")).toBe(1);
    } finally {
      await w.parar();
    }
  });

  it("histerese: cotacoes seguidas acima do limite disparam uma vez", async () => {
    await criarRegra("hist", "BBDC4", "15.00");
    const w = await iniciar();
    try {
      await messaging.publicar(cotacao("BBDC4", "15.50"));
      await esperar(async () => (await notificacoesDa("hist")) === 1);
      await messaging.publicar(cotacao("BBDC4", "15.80"));
      await messaging.publicar(cotacao("BBDC4", "16.00"));
      await new Promise((r) => setTimeout(r, 1500));
      expect(await notificacoesDa("hist")).toBe(1);

      // Cai abaixo, rearma; sobe de novo, dispara a segunda.
      await messaging.publicar(cotacao("BBDC4", "14.00"));
      await esperar(async () => {
        const [r] = await db
          .select({ armado: alertRules.armado })
          .from(alertRules)
          .where(eq(alertRules.id, "hist"));
        return r?.armado === true;
      });
      await messaging.publicar(cotacao("BBDC4", "15.20"));
      await esperar(async () => (await notificacoesDa("hist")) === 2);
    } finally {
      await w.parar();
    }
  });

  it("regra criada com o worker no ar entra no indice sem reiniciar", async () => {
    const w = await iniciar();
    try {
      await criarRegra("nova", "ABEV3", "12.00");
      await esperar(() => Promise.resolve(w.indice.obter("nova") !== undefined));
      await messaging.publicar(cotacao("ABEV3", "12.50"));
      await esperar(async () => (await notificacoesDa("nova")) === 1);
    } finally {
      await w.parar();
    }
  });

  it("nao grava em market_data: idempotencia fica no schema alerts", async () => {
    const r = await pool.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'market_data'",
    );
    expect(r.rows[0].n).toBe(0);
    const [p] = await db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.user_id, "u1")));
    expect(p?.n).toBeGreaterThan(0);
  });
});

describe("carga: 10 mil alertas ativos", () => {
  it("latencia de ponta a ponta nao degrada com 10 mil regras", async () => {
    // 10 mil regras em 2 mil tickers. Um quinto delas casa com as cotacoes
    // publicadas, o resto e carga parada que nao pode custar nada.
    const regras = [];
    for (let k = 0; k < 10_000; k++) {
      const ticker = `CG${String(k % 2000).padStart(4, "0")}`;
      regras.push({
        id: `carga-${k}`,
        user_id: `u${k % 500}`,
        tipo: "preco_acima",
        ticker,
        params: { valor: k % 5 === 0 ? "10.00" : "999.00" },
        canais: ["inapp"],
        cooldown_segundos: 0,
      });
    }
    for (let i = 0; i < regras.length; i += 1000) {
      await db.insert(alertRules).values(regras.slice(i, i + 1000));
    }

    const w = await iniciar();
    try {
      await esperar(() => Promise.resolve(w.indice.tamanho >= 10_000), 30_000);

      // 200 cotacoes em tickers distintos; cada uma casa com 1 regra.
      const latencias: number[] = [];
      for (let q = 0; q < 200; q++) {
        const ticker = `CG${String(q).padStart(4, "0")}`;
        const regraQueCasa = `carga-${q}`;
        // So os multiplos de 5 tem limite 10: escolhe o indice que casa.
        const alvo = q % 5 === 0 ? regraQueCasa : null;
        const t0 = Date.now();
        await messaging.publicar(cotacao(ticker, "11.00"));
        if (alvo) {
          await esperar(async () => (await notificacoesDa(alvo)) === 1, 10_000);
          latencias.push(Date.now() - t0);
        }
      }

      latencias.sort((a, b) => a - b);
      const p95 = latencias[Math.floor(latencias.length * 0.95)] ?? Infinity;
      const max = latencias.at(-1) ?? Infinity;
      console.log(
        `[alerts] carga 10k regras: ${latencias.length} disparos, p95 ${p95} ms, max ${max} ms`,
      );
      expect(p95).toBeLessThan(5000);
    } finally {
      await w.parar();
    }
  }, 180_000);
});
