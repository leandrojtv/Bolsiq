/**
 * Recuperação de jobs agendados que não rodaram.
 *
 * O cron do pg-boss só dispara no horário: com o worker fora do ar nesse
 * momento, a execução se perde e o dado fica parado até o próximo horário
 * (#48). Ao subir, o worker compara o último horário previsto pelo cron de
 * cada job com a última execução e enfileira o que ficou para trás.
 */
import cronParser from "cron-parser";
import type { AdminDeJobs } from "../routes/registrar.js";
import { jobsAgendados, TIMEZONE, type JobDefinition } from "./registry.js";

export interface JobAtrasado {
  name: string;
  previsto: Date;
  dados: Record<string, unknown>;
}

export function ultimoHorarioPrevisto(cron: string, agora: Date): Date {
  return cronParser
    .parseExpression(cron, { currentDate: agora, tz: TIMEZONE })
    .prev()
    .toDate();
}

function diaEmSp(instante: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(instante);
}

export interface Referencia {
  /** Criação da última execução, em qualquer estado. */
  ultimaExecucao: Date | null;
  /** Quando o cron foi registrado no pg-boss (`pgboss.schedule.created_on`). */
  agendadoDesde: Date | null;
}

/**
 * Atrasado é o job cujo último horário previsto caiu depois tanto da última
 * execução quanto do registro do cron.
 *
 * O registro do cron importa por dois motivos. O pg-boss apaga o histórico
 * de execuções depois de 7 dias, e sem ele um job semanal pareceria nunca ter
 * rodado. E num banco novo (CI, e2e) o cron nasce agora: nada fica atrasado,
 * e a primeira carga continua sendo o backfill.
 */
export function jobsAtrasados(
  definicoes: JobDefinition[],
  referencias: Map<string, Referencia>,
  agora: Date,
): JobAtrasado[] {
  const atrasados: JobAtrasado[] = [];
  for (const job of definicoes) {
    if (job.cron === null) continue;
    const ref = referencias.get(job.name);
    const marcos = [ref?.ultimaExecucao, ref?.agendadoDesde].filter(
      (d): d is Date => d instanceof Date,
    );
    if (marcos.length === 0) continue;
    const previsto = ultimoHorarioPrevisto(job.cron, agora);
    if (marcos.some((d) => d >= previsto)) continue;
    // Sem data, o diário carrega o dia de hoje; o que se perdeu foi o pregão
    // do horário previsto.
    const dados = job.name === "b3-cotahist-diario" ? { date: diaEmSp(previsto) } : {};
    atrasados.push({ name: job.name, previsto, dados });
  }

  // O lacunas recarrega todo dia útil anterior a hoje que ficou sem COTAHIST.
  // Rodar o diário do mesmo dia em paralelo só disputa as mesmas linhas
  // (deadlock no Postgres).
  const hoje = diaEmSp(agora);
  const comLacunas = atrasados.some((j) => j.name === "b3-cotahist-lacunas");
  return atrasados.filter(
    (j) => !(comLacunas && j.name === "b3-cotahist-diario" && j.dados.date !== hoje),
  );
}

/**
 * A última execução conta jobs em qualquer estado, inclusive na fila: subir
 * o worker de novo logo depois não enfileira a recuperação duas vezes.
 */
export async function recuperarJobsAtrasados(
  admin: AdminDeJobs,
  agendadosDesde: () => Promise<Map<string, Date>>,
  log: (nivel: "info" | "warn", msg: string, ctx?: object) => void,
  agora: Date = new Date(),
): Promise<JobAtrasado[]> {
  const agendas = await agendadosDesde();
  const referencias = new Map(
    (await admin.listar()).map((j) => [
      j.name,
      {
        ultimaExecucao: j.last_run ? new Date(j.last_run.created_on) : null,
        agendadoDesde: agendas.get(j.name) ?? null,
      },
    ]),
  );
  const atrasados = jobsAtrasados(jobsAgendados(), referencias, agora);
  for (const job of atrasados) {
    const id = await admin.disparar(job.name, job.dados);
    log("info", "job atrasado reenfileirado", {
      job: job.name,
      previsto: job.previsto.toISOString(),
      dados: job.dados,
      id,
    });
  }
  return atrasados;
}
