/**
 * Carga histórica: `make backfill FROM=2024`.
 *
 * Roda os mesmos manipuladores do worker, em ordem, num processo só. A ordem
 * importa: o COTAHIST cria o universo, o cadastro liga ticker a companhia, e
 * só então o DFP/ITR sabe quais tickers citar no `statement.published` (e o
 * informe mensal de FII, no `fii.report.published`).
 *
 * Não fala com o NATS: os eventos vão para o outbox, e o worker publica.
 */
import { criarDb, criarPool } from "@bolsiq/db-core";
import { emitirDiaFechado } from "./dados/ingestao.js";
import { B3CotahistAdapter } from "./fontes/b3-cotahist.js";
import { BcbAdapter } from "./fontes/bcb.js";
import { CvmAdapter } from "./fontes/cvm.js";
import { executarJob, type ContextoDeJob } from "./jobs/handlers.js";

const url = process.env.DATABASE_URL;
const de = Number(process.argv[2] ?? process.env.FROM);
const anoAtual = Number(
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  }).format(new Date()),
);

if (!url || !Number.isInteger(de) || de < 1986 || de > anoAtual) {
  process.stderr.write(
    `uso: backfill <ano inicial entre 1986 e ${anoAtual}> (DATABASE_URL definida)\n`,
  );
  process.exit(1);
}

const log: ContextoDeJob["log"] = (nivel, msg, ctx = {}) =>
  process.stdout.write(`${JSON.stringify({ level: nivel, msg, ...ctx })}\n`);

const pool = criarPool({ url, maxConnections: 4 });
const buscar = (u: string, init?: RequestInit) => fetch(u, init);
const ctx: ContextoDeJob = {
  db: criarDb(pool),
  cotahist: new B3CotahistAdapter(buscar),
  cvm: new CvmAdapter(buscar),
  bcb: new BcbAdapter(buscar),
  log,
};

const anos = Array.from({ length: anoAtual - de + 1 }, (_, i) => de + i);
const etapas: [string, Record<string, unknown>][] = [
  ...anos.map((ano): [string, Record<string, unknown>] => ["b3-cotahist-anual", { ano }]),
  ["cvm-cadastro", {}],
  ...anos.flatMap((ano): [string, Record<string, unknown>][] => [
    ["cvm-dfp", { ano }],
    ["cvm-itr", { ano }],
  ]),
  // Informe mensal de FII depois do COTAHIST, que cria os tickers que o ISIN
  // liga. Um ano antes de FROM, para o DY 12m ter janela cheia desde o inicio.
  ...[de - 1, ...anos].map((ano): [string, Record<string, unknown>] => [
    "cvm-fii-mensal",
    { ano },
  ]),
  ["bcb-sgs", { from: `${de}-01-01` }],
  // Fundos: ~540 mil linhas por mes. O padrao de 13 meses cobre o periodo 1A
  // do comparador; FUNDOS_MESES amplia.
  ["cvm-fundos", { meses: Number(process.env.FUNDOS_MESES ?? 13) }],
];

try {
  for (const [job, dados] of etapas) {
    const inicio = Date.now();
    log("info", "etapa iniciada", { job, ...dados });
    const resultado = await executarJob(job, dados, ctx);
    log("info", "etapa concluída", { job, ...dados, ms: Date.now() - inicio, resultado });
  }
  const dia = await emitirDiaFechado(ctx.db);
  log("info", "backfill concluído", { ultimo_pregao: dia });
} catch (erro) {
  log("error", "backfill falhou", {
    erro: erro instanceof Error ? erro.stack : String(erro),
  });
  process.exitCode = 1;
} finally {
  await pool.end();
}
