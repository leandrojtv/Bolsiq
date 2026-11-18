/**
 * Fila (pg-boss). `iniciarFila` abre a conexão; `consumir` liga os
 * manipuladores, só quando ROLE é `worker` ou `all`. A API usa a mesma fila
 * para o /admin/jobs disparar e listar, sem consumir.
 */
import PgBoss from "pg-boss";
import type { Env } from "./config.js";
import { executarJob, type ContextoDeJob } from "./jobs/handlers.js";
import { jobs, jobsAgendados, TIMEZONE } from "./jobs/registry.js";

export interface Fila {
  boss: PgBoss;
  parar: () => Promise<void>;
}

export async function iniciarFila(env: Env, opcoes: { agendar: boolean }): Promise<Fila> {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    // Fila no schema próprio: não se mistura com as tabelas de domínio.
    schema: "pgboss",
    // Manutenção e agenda só no worker: dois processos agendando o mesmo cron
    // não duplicam job (o pg-boss trava), mas a API não tem por que fazê-lo.
    supervise: opcoes.agendar,
    schedule: opcoes.agendar,
  });

  await boss.start();

  if (opcoes.agendar) {
    // Só quem consome cria as filas. API e worker criando ao mesmo tempo
    // derrubaram o worker com deadlock no create_queue do pg-boss, na primeira
    // subida do compose.
    for (const job of jobs) {
      await comNovaTentativa(() =>
        boss.createQueue(job.name, {
          name: job.name,
          retryLimit: job.retryLimit,
          retryDelay: job.retryDelaySeconds,
          retryBackoff: true,
          expireInSeconds: job.expireInMinutes * 60,
        }),
      );
    }

    for (const job of jobsAgendados()) {
      if (job.cron === null) continue;
      await boss.schedule(job.name, job.cron, undefined, { tz: TIMEZONE });
    }
  }

  return {
    boss,
    parar: async () => {
      await boss.stop({ graceful: true });
    },
  };
}

/** Duas réplicas do worker ainda podem colidir: deadlock é transitório. */
async function comNovaTentativa(
  fn: () => Promise<unknown>,
  tentativas = 5,
): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await fn();
      return;
    } catch (erro) {
      const codigo = (erro as { code?: string }).code;
      if (codigo !== "40P01" || i >= tentativas) throw erro;
      await new Promise((r) => setTimeout(r, 200 * i));
    }
  }
}

/** Liga um manipulador por job. Um job por vez por fila: as cargas são pesadas. */
export async function consumir(
  fila: Fila,
  ctx: ContextoDeJob,
  extras: Record<string, () => Promise<unknown>> = {},
): Promise<void> {
  for (const job of jobs) {
    await fila.boss.work(job.name, { batchSize: 1 }, async ([j]) => {
      if (!j) return;
      ctx.log("info", "job iniciado", { job: job.name, id: j.id });
      const extra = extras[job.name];
      const resultado = extra ? await extra() : await executarJob(job.name, j.data, ctx);
      ctx.log("info", "job concluído", { job: job.name, id: j.id, resultado });
      return resultado;
    });
  }
}
