import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cifrarChave } from "../chaves.js";
import {
  acessoParaImportar,
  apagarArquivosDoJob,
  apagarArquivosVencidos,
  armazemNoPostgres,
  importacoesHoje,
  repositorioDeJobs,
} from "../importacao/postgres.js";
import { saidaVazia } from "../importacao/esquema.js";

const HOST = process.env.TEST_HOST ?? "127.0.0.1";
const MESTRA = Buffer.alloc(32, 7);

let container: StartedTestContainer;
let dono: Pool;
let app: Pool;

beforeAll(async () => {
  container = await new GenericContainer("timescale/timescaledb-ha:pg17")
    .withEnvironment({
      POSTGRES_USER: "dono",
      POSTGRES_PASSWORD: "dono",
      POSTGRES_DB: "ci",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forSuccessfulCommand("pg_isready -h 127.0.0.1 -p 5432"))
    .withStartupTimeout(120_000)
    .start();
  const url = `postgres://dono:dono@${HOST}:${container.getMappedPort(5432)}/ci`;
  dono = new Pool({ connectionString: url, max: 2 });
  const pasta = resolve(import.meta.dirname, "../../migrations");
  for (const arquivo of readdirSync(pasta)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const bloco of readFileSync(resolve(pasta, arquivo), "utf8").split(
      "--> statement-breakpoint",
    ))
      if (bloco.trim()) await dono.query(bloco);
  app = new Pool({ connectionString: url, max: 3 });
  // Como o portfolio-migrate faz: config do usuario "u" pela RLS.
  const c = await dono.connect();
  await c.query("BEGIN");
  await c.query("SET LOCAL ROLE bolsiq_app");
  await c.query("SELECT set_config('bolsiq.user_id', 'u', true)");
  await c.query(
    `INSERT INTO assistant.settings (user_id, provedor, modelo, chave_cifrada, consentimento_importacao_em)
     VALUES ('u', 'deepseek', 'deepseek-flash', $1, now())`,
    [cifrarChave("sk-chave-que-nunca-sai-do-banco-1234", MESTRA, "u")],
  );
  await c.query(
    `INSERT INTO assistant.import_jobs (id, user_id, carteira_id, status) VALUES ('j1', 'u', 'c1', 'lendo')`,
  );
  await c.query(
    `INSERT INTO assistant.import_job_files (id, job_id, user_id, indice, nome, mime, tamanho, dados, estado)
     VALUES ('f1', 'j1', 'u', 0, 'a.pdf', 'application/pdf', 3, '\\x010203', 'pendente')`,
  );
  await c.query("COMMIT");
  c.release();
});

afterAll(async () => {
  await app?.end();
  await dono?.end();
  await container?.stop();
});

const db = () => drizzle(app) as never;

describe("importacao com IA no Postgres", () => {
  it("credencial: decifra a chave, preco do catalogo; outro usuario nao ve nada", async () => {
    const a = await acessoParaImportar(db(), "u", {
      mestra: MESTRA,
      ollama_url: "",
      ollama_hosts: [],
    });
    expect(a).toMatchObject({
      provedor: "deepseek",
      modelo: "deepseek-flash",
      chave: "sk-chave-que-nunca-sai-do-banco-1234",
    });
    expect(a.capacidades.max_saida).toBe(8000);
    await expect(
      acessoParaImportar(db(), "outro", {
        mestra: MESTRA,
        ollama_url: "",
        ollama_hosts: [],
      }),
    ).rejects.toMatchObject({ codigo: "nao_configurado" });
    await expect(
      acessoParaImportar(db(), "u", { mestra: null, ollama_url: "", ollama_hosts: [] }),
    ).rejects.toMatchObject({ codigo: "sem_chave_mestra" });
  });

  it("cache por hash, versao e modelo; consumo conta no limite do dia", async () => {
    const armazem = armazemNoPostgres(
      db(),
      "u",
      "deepseek",
      "deepseek-flash",
      "2026-11-08",
    );
    const chave = {
      hash: "h",
      versao_prompt: "importacao-v2",
      provedor: "deepseek",
      modelo: "deepseek-flash",
    };
    expect(await armazem.buscar(chave)).toBeNull();
    const id = await armazem.gravar({
      chave,
      nome_arquivo: "a.pdf",
      tipo_arquivo: "pdf",
      saida: saidaVazia(),
      relatorio: { linhas: [] } as never,
      uso: { tokens_entrada: 10, tokens_saida: 5 },
      custo_estimado: "0.000010",
      original: null,
    });
    expect((await armazem.buscar(chave))?.id).toBe(id);
    // Reprocessar substitui, com o mesmo id.
    expect(
      await armazem.gravar({
        chave,
        nome_arquivo: "a.pdf",
        tipo_arquivo: "pdf",
        saida: saidaVazia(),
        relatorio: {} as never,
        uso: { tokens_entrada: 1, tokens_saida: 1 },
        custo_estimado: null,
        original: null,
      }),
    ).toBe(id);
    await armazem.atualizarRelatorio(id, { linhas: [1] } as never);
    await armazem.registrarUso({ tokens_entrada: 10, tokens_saida: 5 }, "0.000010");
    expect(
      await importacoesHoje(db(), "u", new Date().toISOString().slice(0, 10)),
    ).toBeGreaterThanOrEqual(1);
  });

  it("job: le, atualiza e apaga o arquivo; o prazo apaga os vencidos", async () => {
    const repo = repositorioDeJobs(db(), "u", "j1");
    expect(await repo.job()).toMatchObject({
      id: "j1",
      status: "lendo",
      cancelado: false,
    });
    const [a] = await repo.arquivos();
    expect([...(a?.dados ?? [])]).toEqual([1, 2, 3]);
    await repo.atualizarJob({ status: "extraindo" });
    await repo.atualizarArquivo(0, {
      estado: "analisando",
      progresso: { etapa: "analisando", feitos: 1, total: 3 },
    });
    expect((await repo.job())?.status).toBe("extraindo");
    expect(await repositorioDeJobs(db(), "outro", "j1").job()).toBeNull();
    await apagarArquivosDoJob(db(), "u", "j1");
    expect((await repo.arquivos())[0]?.dados).toBeNull();
    await dono.query(
      "UPDATE assistant.import_job_files SET dados = '\\x01', atualizado_em = now() - interval '2 days'",
    );
    expect(await apagarArquivosVencidos(drizzle(dono) as never)).toBe(1);
  });
});
