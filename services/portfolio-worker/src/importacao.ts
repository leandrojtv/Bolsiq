/**
 * Importacao com IA em segundo plano (ADR 0027). O web grava o job e os arquivos
 * e enfileira `assistant.importacao`; aqui o job roda com a chave do usuario,
 * pela RLS dele. A cada hora, os arquivos de jobs com mais de 24 horas saem.
 */
import type PgBoss from "pg-boss";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  acessoParaImportar,
  apagarArquivosVencidos,
  armazemNoPostgres,
  criarModelo,
  executarJob,
  ferramentasDoSistema,
  lerChaveMestra,
  mensagemSegura,
  repositorioDeJobs,
  verificadorPorHttp,
  type FerramentasDoSistema,
} from "@bolsiq/assistant";
import type { Env } from "./config.js";

export const FILA_DA_IMPORTACAO = "assistant.importacao";
const LIMPEZA = "assistant.importacao.limpeza";

export interface PedidoDoJob {
  job_id: string;
  user_id: string;
  /** Outro modelo do mesmo provedor (reprocessar com outro modelo). */
  modelo?: string;
  reprocessar?: { indice: number; lotes?: number[] };
}

const hojeEmSp = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export async function iniciarImportacao(
  boss: PgBoss,
  db: NodePgDatabase<Record<string, unknown>>,
  env: Env,
  log: (nivel: string, msg: string, ctx?: Record<string, unknown>) => void,
): Promise<void> {
  const ferramentas: FerramentasDoSistema = await ferramentasDoSistema();
  log("info", "importacao com IA: programas do sistema", {
    programas: Object.keys(ferramentas),
  });
  let mestra: Buffer | null = null;
  try {
    mestra = lerChaveMestra(env.ASSISTANT_MASTER_KEY);
  } catch {
    log("warn", "sem ASSISTANT_MASTER_KEY: importacao com IA so com Ollama");
  }
  const obter = async (caminho: string) => {
    const r = await fetch(`${env.MARKET_DATA_URL}/v1/${caminho}`, {
      headers: env.MARKET_DATA_API_KEY ? { "x-api-key": env.MARKET_DATA_API_KEY } : {},
      signal: AbortSignal.timeout(15_000),
    });
    const corpo: unknown = await r.json().catch(() => null);
    return { status: r.status, corpo };
  };

  await boss.createQueue(FILA_DA_IMPORTACAO, {
    name: FILA_DA_IMPORTACAO,
    // O job nao se repete sozinho: a tela oferece reprocessar.
    retryLimit: 0,
    expireInSeconds: 60 * 60 * 3,
  });
  await boss.work<PedidoDoJob>(
    FILA_DA_IMPORTACAO,
    { batchSize: 1 },
    async ([trabalho]) => {
      if (!trabalho) return;
      const p = trabalho.data;
      const repo = repositorioDeJobs(db, p.user_id, p.job_id);
      const detalhe = (d: string) =>
        log("warn", "importacao com IA", {
          job: p.job_id,
          detalhe: mensagemSegura({ message: d }),
        });
      try {
        const a = await acessoParaImportar(
          db,
          p.user_id,
          {
            mestra,
            ollama_url: env.ASSISTANT_OLLAMA_URL,
            ollama_hosts: env.ASSISTANT_OLLAMA_HOSTS.split(",")
              .map((h) => h.trim())
              .filter(Boolean),
            deepseek_url: env.ASSISTANT_DEEPSEEK_URL ?? null,
          },
          p.modelo,
        );
        const inicio = Date.now();
        await executarJob(
          {
            repo,
            acesso: {
              modelo: criarModelo(a, a.modelo),
              provedor: a.provedor,
              nome_do_modelo: a.modelo,
              preco: a.preco,
              capacidades: a.capacidades,
              segredos: a.chave ? [a.chave] : [],
              guardar_original: a.guardar_original,
            },
            armazem: armazemNoPostgres(db, p.user_id, a.provedor, a.modelo, hojeEmSp()),
            verificador: verificadorPorHttp(obter),
            ferramentas,
            hoje: hojeEmSp(),
            tolerancia: env.ASSISTANT_IMPORT_TOLERANCE,
            limite_diario: env.ASSISTANT_IMPORT_DAILY,
            limites_do_envio: {
              bytes: env.ASSISTANT_IMPORT_MAX_MB * 1024 * 1024,
              paginas: env.ASSISTANT_IMPORT_MAX_PAGES,
              arquivos: env.ASSISTANT_IMPORT_MAX_FILES,
            },
            confirmar_acima_usd: env.ASSISTANT_IMPORT_CONFIRM_USD,
            aoErrar: detalhe,
          },
          p.reprocessar ? { reprocessar: p.reprocessar } : {},
        );
        log("info", "importacao com IA concluida", {
          job: p.job_id,
          ms: Date.now() - inicio,
        });
      } catch (erro) {
        // Erro antes de comecar (configuracao, chave): vai para o job, em portugues.
        const mensagem = (erro as { codigo?: string }).codigo
          ? (erro as Error).message
          : "Não foi possível processar a importação. Tente de novo.";
        detalhe(mensagemSegura(erro));
        await repo.atualizarJob({ status: "falhou", erro: mensagem });
      }
    },
  );

  await boss.createQueue(LIMPEZA, { name: LIMPEZA });
  await boss.schedule(LIMPEZA, "17 * * * *", undefined, { tz: "America/Sao_Paulo" });
  await boss.work(LIMPEZA, async () => {
    const n = await apagarArquivosVencidos(db, 24);
    if (n > 0) log("info", "arquivos de importacao vencidos apagados", { n });
  });
}
