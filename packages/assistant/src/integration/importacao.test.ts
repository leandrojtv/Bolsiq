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
import { abrirArquivosDoEnvio } from "../importacao/envio.js";
import { executarJob } from "../importacao/job.js";
import type { ResultadoDaLeituraFinancas } from "../importacao/servico-financas.js";
import {
  CAPACIDADES_COMPLETAS,
  modeloDeRoteiro,
  verificadorDasFixtures,
} from "../../eval/importacao/executar.js";
import { ferramentasDeFinancas } from "../../eval/importacao/executar-financas.js";
import { HOJE } from "../../eval/importacao/fixtures.js";
import {
  FATURA_INTER,
  FATURA_SANTANDER,
} from "../../eval/importacao/fixtures-financas.js";

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

  it("job do Financas: senha so no envio, leitura pela IA e pelo atalho, nada da senha no banco", async () => {
    const senha = FATURA_INTER.senha as string;
    const enviado = (f: typeof FATURA_INTER, s = "") => {
      const e = f.arquivo();
      if (!("bytes" in e)) throw new Error("sem arquivo");
      return { ...e, corretora: "", senha: s };
    };
    const { abertos } = await abrirArquivosDoEnvio(
      [enviado(FATURA_INTER, senha), enviado(FATURA_SANTANDER)],
      ferramentasDeFinancas(FATURA_INTER),
      { limite_mb: 50, documento: "financas" },
    );
    // O que o web grava: o job sem carteira e os arquivos ja abertos.
    const c = await dono.connect();
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE bolsiq_app");
    await c.query("SELECT set_config('bolsiq.user_id', 'u', true)");
    await c.query(
      `INSERT INTO assistant.import_jobs (id, user_id, documento, status) VALUES ('jf', 'u', 'financas', 'lendo')`,
    );
    for (const [i, a] of abertos.entries())
      await c.query(
        `INSERT INTO assistant.import_job_files (id, job_id, user_id, indice, nome, mime, tamanho, dados, estado)
         VALUES ($1, 'jf', 'u', $2, $3, $4, $5, $6, 'pendente')`,
        [`ff${i}`, i, a.nome, a.mime, a.bytes.byteLength, Buffer.from(a.bytes)],
      );
    await c.query("COMMIT");
    c.release();
    // Job da carteira continua exigindo a carteira.
    await expect(
      dono.query(
        `INSERT INTO assistant.import_jobs (id, user_id, documento, status) VALUES ('jx', 'u', 'carteira', 'lendo')`,
      ),
    ).rejects.toThrow(/import_jobs_documento_ck/);

    const repo = repositorioDeJobs(db(), "u", "jf");
    expect((await repo.job())?.documento).toBe("financas");
    const log: string[] = [];
    await executarJob({
      repo,
      acesso: {
        modelo: modeloDeRoteiro(FATURA_SANTANDER.resposta),
        provedor: "deepseek",
        nome_do_modelo: "deepseek-flash",
        preco: { entrada: 1, saida: 2 },
        capacidades: CAPACIDADES_COMPLETAS,
        segredos: [],
        guardar_original: false,
      },
      armazem: armazemNoPostgres(db(), "u", "deepseek", "deepseek-flash", HOJE),
      verificador: verificadorDasFixtures(),
      ferramentas: {},
      hoje: HOJE,
      limite_diario: 100,
      confirmar_acima_usd: 10,
      espera_base_ms: 1,
      aoErrar: (d) => log.push(d),
    });
    expect((await repo.job())?.status).toBe("pronto");
    const r = await dono.query<{ indice: number; resultado: ResultadoDaLeituraFinancas }>(
      "SELECT indice, resultado FROM assistant.import_job_files WHERE job_id = 'jf' ORDER BY indice",
    );
    expect(r.rows.map((x) => [x.resultado.documento, x.resultado.atalho])).toEqual([
      ["financas", true],
      ["financas", false],
    ]);
    expect(r.rows[1]?.resultado.validacao.conferencia?.confere).toBe(true);
    const ext = await dono.query<{ provedor: string; versao_prompt: string }>(
      "SELECT provedor, versao_prompt FROM assistant.extractions WHERE user_id = 'u' AND versao_prompt = 'importacao-financas-v1' ORDER BY provedor",
    );
    expect(ext.rows.map((x) => x.provedor)).toEqual(["atalho", "deepseek"]);
    const tudo = await dono.query<{ t: string }>(
      `SELECT concat_ws('|', (SELECT string_agg(j::text, '|') FROM assistant.import_jobs j),
                             (SELECT string_agg(f::text, '|') FROM assistant.import_job_files f),
                             (SELECT string_agg(e::text, '|') FROM assistant.extractions e),
                             (SELECT string_agg(u::text, '|') FROM assistant.usage u)) AS t`,
    );
    expect(tudo.rows[0]?.t ?? "").not.toContain(senha);
    expect(log.join("\n")).not.toContain(senha);
  });
});
