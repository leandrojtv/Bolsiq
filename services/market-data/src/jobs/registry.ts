/**
 * Registro dos jobs e da agenda.
 *
 * Os horários são em America/Sao_Paulo, e o pg-boss recebe o fuso explicitamente
 * — não um deslocamento fixo. O Brasil não tem horário de verão hoje; se
 * voltar, `19:30` muda de UTC e só o fuso nomeado continua correto (ADR 0006).
 */

export interface JobDefinition {
  name: string;
  description: string;
  /** Expressão cron, ou `null` para job só sob demanda. */
  cron: string | null;
  /** Tentativas antes de desistir. O backoff é exponencial. */
  retryLimit: number;
  retryDelaySeconds: number;
  /** Tempo máximo de execução antes de considerar travado. */
  expireInMinutes: number;
}

export const TIMEZONE = "America/Sao_Paulo";

export const jobs: JobDefinition[] = [
  {
    name: "b3-cotahist-diario",
    description: "COTAHIST do dia e atualização do universo",
    // 20:30 em dias úteis. Às 19:30 a B3 ainda não tinha publicado o arquivo
    // do dia, e o 404 fazia o pregão ser descartado (#29). O horário exato da
    // publicação não é divulgado; quem garante o dia é `b3-cotahist-lacunas`.
    cron: "30 20 * * 1-5",
    retryLimit: 5,
    retryDelaySeconds: 60,
    expireInMinutes: 30,
  },
  {
    name: "b3-cotahist-lacunas",
    description: "Recarrega dia útil que ficou sem COTAHIST",
    // 7:00: o arquivo do dia anterior já saiu, com folga.
    cron: "0 7 * * 1-5",
    retryLimit: 3,
    retryDelaySeconds: 300,
    expireInMinutes: 60,
  },
  {
    name: "b3-cotahist-anual",
    description: "COTAHIST de um ano inteiro (carga histórica)",
    cron: null,
    retryLimit: 3,
    retryDelaySeconds: 300,
    expireInMinutes: 240,
  },
  {
    name: "cvm-fundos",
    description: "Informe diário de fundos",
    cron: "0 6 * * *",
    retryLimit: 5,
    retryDelaySeconds: 120,
    expireInMinutes: 60,
  },
  {
    name: "cvm-fii-mensal",
    description: "Informe mensal de FII; reprocessa só se o hash mudou",
    // Os administradores entregam ao longo do mês: conferir todo dia é barato.
    cron: "30 6 * * *",
    retryLimit: 3,
    retryDelaySeconds: 300,
    expireInMinutes: 30,
  },
  {
    name: "bcb-sgs",
    description: "Séries do SGS usadas como benchmark",
    cron: "0 6 * * *",
    retryLimit: 5,
    retryDelaySeconds: 60,
    expireInMinutes: 15,
  },
  {
    name: "cvm-cadastro",
    description: "Cadastro de companhias abertas",
    cron: "0 5 * * 1",
    retryLimit: 3,
    retryDelaySeconds: 300,
    expireInMinutes: 30,
  },
  {
    name: "cvm-dfp",
    description: "Demonstrações anuais; reprocessa só se o hash mudou",
    cron: "30 5 * * 1",
    retryLimit: 3,
    retryDelaySeconds: 300,
    expireInMinutes: 120,
  },
  {
    name: "cvm-itr",
    description: "Demonstrações trimestrais; reprocessa só se o hash mudou",
    cron: "0 6 * * 1",
    retryLimit: 3,
    retryDelaySeconds: 300,
    expireInMinutes: 120,
  },
  {
    name: "outbox-publish",
    description:
      "Publica o outbox no NATS. Normalmente roda no loop do worker; aqui fica disponível para execução sob demanda",
    cron: null,
    retryLimit: 3,
    retryDelaySeconds: 10,
    expireInMinutes: 10,
  },
  {
    name: "ajuste-proventos",
    description: "Recalcula adj_close quando entra evento novo",
    cron: null,
    retryLimit: 3,
    retryDelaySeconds: 60,
    expireInMinutes: 60,
  },
];

export function acharJob(nome: string): JobDefinition | undefined {
  return jobs.find((job) => job.name === nome);
}

export function jobsAgendados(): JobDefinition[] {
  return jobs.filter((job) => job.cron !== null);
}
