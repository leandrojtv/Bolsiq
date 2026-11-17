import { describe, expect, it } from "vitest";
import type { JobInfo } from "@bolsiq/contracts";
import type { AdminDeJobs } from "../routes/registrar.js";
import { jobs, jobsAgendados } from "./registry.js";
import {
  jobsAtrasados,
  recuperarJobsAtrasados,
  ultimoHorarioPrevisto,
  type Referencia,
} from "./recuperacao.js";

// Terça, 17/11/2026, 09:36 em São Paulo (UTC-3).
const AGORA = new Date("2026-11-17T12:36:00Z");
// Cron registrado no pg-boss bem antes do cenário.
const AGENDADO = "2026-11-03T23:32:46Z";

function refs(
  ultimas: Record<string, string | null>,
  agendadoDesde: string | null = AGENDADO,
): Map<string, Referencia> {
  return new Map(
    Object.entries(ultimas).map(([nome, ultima]) => [
      nome,
      {
        ultimaExecucao: ultima ? new Date(ultima) : null,
        agendadoDesde: agendadoDesde ? new Date(agendadoDesde) : null,
      },
    ]),
  );
}

const nomes = (lista: { name: string }[]) => lista.map((j) => j.name).sort();

describe("ultimoHorarioPrevisto", () => {
  it("usa o fuso de São Paulo", () => {
    // 07:00 de terça em SP = 10:00 UTC.
    expect(ultimoHorarioPrevisto("0 7 * * 1-5", AGORA).toISOString()).toBe(
      "2026-11-17T10:00:00.000Z",
    );
  });

  it("pula o fim de semana nos crons de dia útil", () => {
    // Segunda, 09:00 SP: o último 20:30 útil foi sexta.
    const segunda = new Date("2026-11-16T12:00:00Z");
    expect(ultimoHorarioPrevisto("30 20 * * 1-5", segunda).toISOString()).toBe(
      "2026-11-13T23:30:00.000Z",
    );
  });

  it("aceita todo cron do registro", () => {
    for (const job of jobsAgendados()) {
      expect(() => ultimoHorarioPrevisto(job.cron as string, AGORA)).not.toThrow();
    }
  });
});

describe("jobsAtrasados", () => {
  // Cenário do #48: worker parado de sábado 14/11 à tarde até terça 09:36. O
  // histórico dos semanais (09/11) já tinha sido apagado pelo pg-boss.
  const cenario = refs({
    "b3-cotahist-diario": "2026-11-13T23:30:05Z",
    "b3-cotahist-lacunas": "2026-11-13T10:00:05Z",
    "cvm-fundos": "2026-11-14T09:00:15Z",
    "cvm-fii-mensal": "2026-11-14T09:30:12Z",
    "bcb-sgs": "2026-11-14T09:00:15Z",
    "cvm-cadastro": null,
    "cvm-dfp": null,
    "cvm-itr": null,
  });

  it("reenfileira tudo que perdeu horário enquanto o worker estava fora", () => {
    expect(nomes(jobsAtrasados(jobs, cenario, AGORA))).toEqual(
      [
        "b3-cotahist-lacunas",
        "bcb-sgs",
        "cvm-cadastro",
        "cvm-dfp",
        "cvm-fii-mensal",
        "cvm-fundos",
        "cvm-itr",
      ].sort(),
    );
  });

  it("deixa o pregão perdido para o lacunas, sem rodar o diário em paralelo", () => {
    const lista = jobsAtrasados(jobs, cenario, AGORA);
    expect(lista.find((j) => j.name === "b3-cotahist-diario")).toBeUndefined();
  });

  it("pede ao diário o pregão perdido quando o lacunas está em dia", () => {
    // Terça 09:36: lacunas rodou às 07:00, o diário de segunda 20:30 não.
    const lista = jobsAtrasados(
      jobs,
      refs({
        "b3-cotahist-diario": "2026-11-13T23:30:05Z",
        "b3-cotahist-lacunas": "2026-11-17T10:00:03Z",
      }),
      AGORA,
    );
    expect(lista).toEqual([
      {
        name: "b3-cotahist-diario",
        previsto: new Date("2026-11-16T23:30:00Z"),
        dados: { date: "2026-11-16" },
      },
    ]);
  });

  it("roda o diário de hoje junto com o lacunas: os dias não se sobrepõem", () => {
    // Terça 22:00, tudo perdido desde sexta.
    const noite = new Date("2026-11-18T01:00:00Z");
    const lista = jobsAtrasados(
      jobs,
      refs({
        "b3-cotahist-diario": "2026-11-13T23:30:05Z",
        "b3-cotahist-lacunas": "2026-11-13T10:00:05Z",
      }),
      noite,
    );
    expect(lista.find((j) => j.name === "b3-cotahist-diario")?.dados).toEqual({
      date: "2026-11-17",
    });
    expect(nomes(lista)).toContain("b3-cotahist-lacunas");
  });

  it("não mexe no job que rodou depois do último horário previsto", () => {
    const emDia = refs({
      "b3-cotahist-lacunas": "2026-11-17T10:00:03Z",
      "bcb-sgs": "2026-11-17T09:00:02Z",
    });
    expect(jobsAtrasados(jobs, emDia, AGORA)).toEqual([]);
  });

  it("conta o job ainda na fila como execução", () => {
    const naFila = refs({ "bcb-sgs": "2026-11-17T12:36:01Z" });
    expect(jobsAtrasados(jobs, naFila, AGORA)).toEqual([]);
  });

  it("não dispara nada num banco novo: o cron acabou de ser registrado", () => {
    const novo = refs({ "bcb-sgs": null, "cvm-dfp": null }, "2026-11-17T12:35:59Z");
    expect(jobsAtrasados(jobs, novo, AGORA)).toEqual([]);
  });

  it("ignora job sem referência nenhuma e job sem cron", () => {
    const nada = new Map<string, Referencia>([
      ["bcb-sgs", { ultimaExecucao: null, agendadoDesde: null }],
      [
        "b3-cotahist-anual",
        { ultimaExecucao: new Date("2020-01-01T00:00:00Z"), agendadoDesde: null },
      ],
    ]);
    expect(jobsAtrasados(jobs, nada, AGORA)).toEqual([]);
  });
});

describe("recuperarJobsAtrasados", () => {
  it("dispara pelo admin os atrasados e devolve a lista", async () => {
    const disparados: [string, Record<string, unknown>][] = [];
    const info = (name: string, created_on: string | null): JobInfo => ({
      name,
      description: "",
      cron: null,
      queued: 0,
      last_run: created_on
        ? { id: "x", state: "completed", created_on, completed_on: created_on }
        : null,
    });
    const admin: AdminDeJobs = {
      listar: () =>
        Promise.resolve([
          info("b3-cotahist-lacunas", "2026-11-13T10:00:05Z"),
          info("bcb-sgs", "2026-11-17T09:00:02Z"),
          info("cvm-dfp", null),
          info("cvm-fundos", null),
        ]),
      disparar: (nome, dados) => {
        disparados.push([nome, dados]);
        return Promise.resolve(`id-${nome}`);
      },
    };
    // cvm-fundos sem cron registrado: nunca agendado, fica de fora.
    const agendas = new Map(
      ["b3-cotahist-lacunas", "bcb-sgs", "cvm-dfp"].map((n) => [n, new Date(AGENDADO)]),
    );

    const atrasados = await recuperarJobsAtrasados(
      admin,
      () => Promise.resolve(agendas),
      () => undefined,
      AGORA,
    );

    expect(nomes(atrasados)).toEqual(["b3-cotahist-lacunas", "cvm-dfp"]);
    expect(disparados.sort()).toEqual([
      ["b3-cotahist-lacunas", {}],
      ["cvm-dfp", {}],
    ]);
  });
});
