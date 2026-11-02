import type PgBoss from "pg-boss";
import { sql } from "drizzle-orm";
import { BolsiqError, type JobInfo } from "@bolsiq/contracts";
import type { Db } from "@bolsiq/db-core";
import type { AdminDeJobs } from "../routes/registrar.js";
import { acharJob, jobs } from "./registry.js";

interface LinhaDeExecucao extends Record<string, unknown> {
  id: string;
  state: string;
  created_on: string | Date;
  completed_on: string | Date | null;
}

function iso(v: string | Date | null): string | null {
  return v === null ? null : new Date(v).toISOString();
}

/**
 * `/admin/jobs` sobre o pg-boss.
 *
 * A última execução vem das tabelas do pg-boss (`job` e, depois de
 * arquivada, `archive`): é o mesmo registro que o worker escreve, não uma
 * cópia que pode divergir.
 */
export function adminDoPgBoss(boss: PgBoss, db: Db): AdminDeJobs {
  return {
    async listar(): Promise<JobInfo[]> {
      return Promise.all(
        jobs.map(async (job) => {
          const r = await db.execute<LinhaDeExecucao>(sql`
            SELECT id::text, state::text, created_on, completed_on FROM (
              SELECT id, state, created_on, completed_on FROM pgboss.job WHERE name = ${job.name}
              UNION ALL
              SELECT id, state, created_on, completed_on FROM pgboss.archive WHERE name = ${job.name}
            ) t ORDER BY created_on DESC LIMIT 1`);
          const ultima = r.rows[0];
          return {
            name: job.name,
            description: job.description,
            cron: job.cron,
            queued: await boss.getQueueSize(job.name),
            last_run: ultima
              ? {
                  id: ultima.id,
                  state: ultima.state,
                  created_on: iso(ultima.created_on) as string,
                  completed_on: iso(ultima.completed_on),
                }
              : null,
          };
        }),
      );
    },

    async disparar(nome, dados) {
      const job = acharJob(nome);
      if (!job) throw new BolsiqError("not_found", `job ${nome} não existe`);
      let id: string | null;
      try {
        id = await boss.send(nome, dados, {
          retryLimit: job.retryLimit,
          retryDelay: job.retryDelaySeconds,
          retryBackoff: true,
          expireInMinutes: job.expireInMinutes,
        });
      } catch (erro) {
        // A fila é criada pelo worker. Antes de ele subir, ela não existe.
        if (erro instanceof Error && /not found|does not exist/i.test(erro.message)) {
          throw new BolsiqError(
            "source_unavailable",
            "fila ainda não criada; o worker está no ar?",
          );
        }
        throw erro;
      }
      if (!id) throw new BolsiqError("internal_error", "pg-boss não criou o job");
      return id;
    },
  };
}
