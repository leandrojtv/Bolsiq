/**
 * Consumidor da fila (pg-boss), ativo quando ROLE é `worker` ou `all`.
 *
 * Os handlers ainda não existem: cada adapter de fonte será registrado aqui
 * conforme nascer. A estrutura — fila, agenda, retry com backoff — já está de
 * pé, e é o que `/admin/jobs` vai consultar.
 */
import PgBoss from "pg-boss";
import type { Env } from "./config.js";
import { jobs, jobsAgendados, TIMEZONE } from "./jobs/registry.js";

export interface Worker {
  boss: PgBoss;
  parar: () => Promise<void>;
}

export async function iniciarWorker(env: Env): Promise<Worker> {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    // Fila no schema próprio: não se mistura com as tabelas de domínio.
    schema: "pgboss",
    retryBackoff: true,
  });

  await boss.start();

  for (const job of jobs) {
    await boss.createQueue(job.name);
  }

  for (const job of jobsAgendados()) {
    if (job.cron === null) continue;
    await boss.schedule(job.name, job.cron, undefined, { tz: TIMEZONE });
  }

  return {
    boss,
    parar: async () => {
      await boss.stop({ graceful: true });
    },
  };
}
