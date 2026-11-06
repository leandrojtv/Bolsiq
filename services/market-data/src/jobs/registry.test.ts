import { describe, expect, it } from "vitest";
import { acharJob, jobs, jobsAgendados, TIMEZONE } from "./registry.js";

describe("registro de jobs", () => {
  it("usa fuso nomeado, não deslocamento fixo", () => {
    // Se o horário de verão voltar, só o fuso nomeado continua correto.
    expect(TIMEZONE).toBe("America/Sao_Paulo");
  });

  it("não tem nome repetido", () => {
    const nomes = jobs.map((j) => j.name);
    expect(new Set(nomes).size).toBe(nomes.length);
  });

  it("cobre as fontes do market-data", () => {
    const nomes = jobs.map((j) => j.name);
    expect(nomes).toEqual(
      expect.arrayContaining([
        "b3-cotahist-diario",
        "b3-cotahist-anual",
        "b3-cotahist-lacunas",
        "cvm-cadastro",
        "cvm-dfp",
        "cvm-itr",
        "cvm-fundos",
        "bcb-sgs",
        "ajuste-proventos",
      ]),
    );
  });

  it("agenda o COTAHIST às 20:30 em dias úteis", () => {
    // 19:30 era antes da publicação do arquivo, e o 404 descartava o pregão
    // (#29).
    const diario = acharJob("b3-cotahist-diario");
    expect(diario?.cron).toBe("30 20 * * 1-5");
  });

  it("varre lacunas de manhã, depois da publicação do dia anterior", () => {
    const lacunas = acharJob("b3-cotahist-lacunas");
    expect(lacunas?.cron).toBe("0 7 * * 1-5");
  });

  it("agenda fundos e BCB às 06:00 todos os dias", () => {
    expect(acharJob("cvm-fundos")?.cron).toBe("0 6 * * *");
    expect(acharJob("bcb-sgs")?.cron).toBe("0 6 * * *");
  });

  it("confere DFP e ITR semanalmente", () => {
    // O reprocessamento só acontece se o hash mudar, então conferir toda
    // semana é barato.
    expect(acharJob("cvm-dfp")?.cron).toMatch(/\* \* 1$/);
    expect(acharJob("cvm-itr")?.cron).toMatch(/\* \* 1$/);
  });

  it("deixa carga histórica e ajuste de proventos sob demanda", () => {
    expect(acharJob("b3-cotahist-anual")?.cron).toBeNull();
    expect(acharJob("ajuste-proventos")?.cron).toBeNull();
  });

  it("jobsAgendados devolve só os que têm cron", () => {
    const agendados = jobsAgendados();
    expect(agendados.length).toBeGreaterThan(0);
    expect(agendados.every((j) => j.cron !== null)).toBe(true);
    expect(agendados.map((j) => j.name)).not.toContain("b3-cotahist-anual");
  });

  it("todo job tem retry com backoff e expiração plausíveis", () => {
    for (const job of jobs) {
      expect(job.retryLimit).toBeGreaterThan(0);
      expect(job.retryDelaySeconds).toBeGreaterThan(0);
      expect(job.expireInMinutes).toBeGreaterThan(0);
      expect(job.description).not.toBe("");
    }
  });

  it("dá mais tempo à carga histórica que à diária", () => {
    const anual = acharJob("b3-cotahist-anual");
    const diario = acharJob("b3-cotahist-diario");
    expect(anual?.expireInMinutes).toBeGreaterThan(diario?.expireInMinutes ?? 0);
  });

  it("acharJob devolve undefined para nome inexistente", () => {
    expect(acharJob("nao-existe")).toBeUndefined();
  });
});
