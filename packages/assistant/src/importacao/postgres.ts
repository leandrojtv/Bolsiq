import { randomUUID } from "node:crypto";
import { and, count, eq, gte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { comoUsuario } from "@bolsiq/portfolio";
import {
  capacidadesDoModelo,
  modelosParaImportar,
  registroDoModelo,
  type Provedor,
} from "../catalogo.js";
import { decifrarChave } from "../chaves.js";
import {
  extractions,
  importJobFiles,
  importJobs,
  settings,
  usage,
} from "../db/schema.js";
import { urlDoOllama, type Credencial } from "../provedores.js";
import type { ArquivoDoJob, JobDeImportacao, RepositorioDeJobs } from "./job.js";
import { ErroDeImportacao } from "./recebimento.js";
import type { ArmazemDeImportacao } from "./servico.js";
import type { Verificador } from "./validacao.js";

/**
 * Persistencia da importacao com IA no schema `assistant`, sempre pela RLS
 * (`comoUsuario`). O mesmo codigo no BFF e no worker.
 */

// O banco do app ou do worker: qualquer schema do Drizzle.
type Banco = NodePgDatabase<Record<string, unknown>>;

/** Inicio do dia em Sao Paulo, para o limite diario. */
export const inicioDoDiaEmSp = (hoje: string) => `${hoje}T00:00:00-03:00`;

export function importacoesHoje(db: Banco, uid: string, hoje: string): Promise<number> {
  return comoUsuario(db, uid, async (tx) => {
    const [n] = await tx
      .select({ n: count() })
      .from(usage)
      .where(
        and(
          eq(usage.user_id, uid),
          gte(usage.criado_em, inicioDoDiaEmSp(hoje)),
          eq(usage.origem, "importacao"),
        ),
      );
    return n?.n ?? 0;
  });
}

/** Cache por hash, versao do prompt e modelo; consumo com `origem = 'importacao'`. */
export function armazemNoPostgres(
  db: Banco,
  uid: string,
  provedor: string,
  modelo: string,
  hoje: string,
): ArmazemDeImportacao {
  return {
    buscar: (c) =>
      comoUsuario(db, uid, async (tx) => {
        const [l] = await tx
          .select({ id: extractions.id, saida: extractions.extraido })
          .from(extractions)
          .where(
            and(
              eq(extractions.user_id, uid),
              eq(extractions.hash, c.hash),
              eq(extractions.versao_prompt, c.versao_prompt),
              eq(extractions.provedor, c.provedor),
              eq(extractions.modelo, c.modelo),
            ),
          );
        return l ?? null;
      }),
    feitasHoje: () => importacoesHoje(db, uid, hoje),
    gravar: (r) =>
      comoUsuario(db, uid, async (tx) => {
        const valores = {
          extraido: r.saida,
          relatorio: r.relatorio,
          tokens_entrada: r.uso.tokens_entrada,
          tokens_saida: r.uso.tokens_saida,
          custo_estimado: r.custo_estimado,
          original: r.original ? Buffer.from(r.original.dados) : null,
          original_mime: r.original?.mime ?? null,
          nome_arquivo: r.nome_arquivo.slice(0, 200),
          tipo_arquivo: r.tipo_arquivo,
          confirmado_em: null,
        };
        // Reprocessar o mesmo arquivo com o mesmo modelo substitui a extracao.
        const [l] = await tx
          .insert(extractions)
          .values({
            id: randomUUID(),
            user_id: uid,
            hash: r.chave.hash,
            versao_prompt: r.chave.versao_prompt,
            provedor: r.chave.provedor,
            modelo: r.chave.modelo,
            ...valores,
          })
          .onConflictDoUpdate({
            target: [
              extractions.user_id,
              extractions.hash,
              extractions.versao_prompt,
              extractions.provedor,
              extractions.modelo,
            ],
            set: { ...valores, criado_em: sql`now()` },
          })
          .returning({ id: extractions.id });
        return (l as { id: string }).id;
      }),
    atualizarRelatorio: (id, relatorio) =>
      comoUsuario(db, uid, async (tx) => {
        await tx.update(extractions).set({ relatorio }).where(eq(extractions.id, id));
      }),
    registrarUso: (uso, custo) =>
      comoUsuario(db, uid, async (tx) => {
        await tx.insert(usage).values({
          id: randomUUID(),
          user_id: uid,
          conversation_id: null,
          provedor,
          modelo,
          plataforma: false,
          origem: "importacao",
          tokens_entrada: uso.tokens_entrada,
          tokens_saida: uso.tokens_saida,
          custo_estimado: custo,
        });
      }),
  };
}

/** O job e os arquivos dele, pela RLS. */
export function repositorioDeJobs(
  db: Banco,
  uid: string,
  jobId: string,
): RepositorioDeJobs {
  return {
    job: () =>
      comoUsuario(db, uid, async (tx) => {
        const [j] = await tx
          .select({
            id: importJobs.id,
            status: importJobs.status,
            aceitou_imagem: importJobs.aceitou_imagem,
            confirmado: importJobs.confirmado,
            cancelado: importJobs.cancelado,
          })
          .from(importJobs)
          .where(eq(importJobs.id, jobId));
        return (j as JobDeImportacao | undefined) ?? null;
      }),
    arquivos: () =>
      comoUsuario(db, uid, async (tx) => {
        const linhas = await tx
          .select({
            indice: importJobFiles.indice,
            nome: importJobFiles.nome,
            mime: importJobFiles.mime,
            corretora: importJobFiles.corretora,
            dados: importJobFiles.dados,
            estado: importJobFiles.estado,
          })
          .from(importJobFiles)
          .where(eq(importJobFiles.job_id, jobId))
          .orderBy(importJobFiles.indice);
        return linhas.map((l) => ({
          ...l,
          dados: l.dados ? new Uint8Array(l.dados) : null,
        })) as ArquivoDoJob[];
      }),
    atualizarJob: (c) =>
      comoUsuario(db, uid, async (tx) => {
        await tx
          .update(importJobs)
          .set({ ...c, atualizado_em: sql`now()` })
          .where(eq(importJobs.id, jobId));
      }),
    atualizarArquivo: (indice, c) =>
      comoUsuario(db, uid, async (tx) => {
        await tx
          .update(importJobFiles)
          .set({ ...c, atualizado_em: sql`now()` })
          .where(
            and(eq(importJobFiles.job_id, jobId), eq(importJobFiles.indice, indice)),
          );
      }),
  };
}

/** O arquivo sai do banco: confirmacao, cancelamento ou prazo de 24 horas. */
export function apagarArquivosDoJob(
  db: Banco,
  uid: string,
  jobId: string,
): Promise<void> {
  return comoUsuario(db, uid, async (tx) => {
    await tx
      .update(importJobFiles)
      .set({ dados: null })
      .where(eq(importJobFiles.job_id, jobId));
  });
}

/**
 * Prazo dos arquivos em processamento. Roda pela conexao do dono (todos os
 * usuarios), como a limpeza de qualquer dado temporario.
 */
export async function apagarArquivosVencidos(db: Banco, horas = 24): Promise<number> {
  const r = await db.execute(
    sql`update assistant.import_job_files set dados = null
        where dados is not null and atualizado_em < now() - make_interval(hours => ${horas})`,
  );
  return r.rowCount ?? 0;
}

export interface OpcoesDaCredencial {
  /** Chave-mestra (ASSISTANT_MASTER_KEY); sem ela, so provedor sem chave. */
  mestra: Buffer | null;
  ollama_url: string;
  ollama_hosts: readonly string[];
  deepseek_url?: string | null;
}

export interface AcessoParaImportar extends Credencial {
  provedor: Provedor;
  modelo: string;
  preco: { entrada: number | null; saida: number | null };
  capacidades: ReturnType<typeof capacidadesDoModelo>;
  guardar_original: boolean;
}

/**
 * Chave e modelo do usuario: a mesma configuracao do assistente. Outro modelo,
 * so do mesmo provedor e da lista (e a mesma chave). Qualquer modelo de texto
 * importa: as capacidades escolhem a estrategia, nao bloqueiam (ADR 0027).
 */
export async function acessoParaImportar(
  db: Banco,
  uid: string,
  o: OpcoesDaCredencial,
  outroModelo?: string,
): Promise<AcessoParaImportar> {
  const s = await comoUsuario(db, uid, async (tx) => {
    const [l] = await tx.select().from(settings).where(eq(settings.user_id, uid));
    return l ?? null;
  });
  if (!s?.provedor || !s.modelo)
    throw new ErroDeImportacao(
      "nao_configurado",
      "Configure um provedor e um modelo em Configurações do assistente para importar com IA.",
      409,
    );
  if (!s.consentimento_importacao_em)
    throw new ErroDeImportacao(
      "consentimento",
      "Confirme o envio do documento ao provedor antes da primeira importação com IA.",
      409,
    );
  const provedor = s.provedor as Provedor;
  const modelo = outroModelo || s.modelo;
  if (
    outroModelo &&
    outroModelo !== s.modelo &&
    !modelosParaImportar(provedor).some((m) => m.modelo === outroModelo)
  )
    throw new ErroDeImportacao(
      "modelo_invalido",
      "Escolha um modelo da lista do mesmo provedor.",
      422,
    );
  if (s.chave_cifrada && !o.mestra)
    throw new ErroDeImportacao(
      "sem_chave_mestra",
      "O servidor está sem a chave-mestra (ASSISTANT_MASTER_KEY) para abrir a chave do provedor.",
      503,
    );
  const registro = registroDoModelo(provedor, modelo);
  const mesmo = modelo === s.modelo;
  const baseUrl =
    provedor === "ollama"
      ? urlDoOllama(s.base_url || o.ollama_url, o.ollama_hosts)
      : provedor === "deepseek"
        ? (o.deepseek_url ?? null)
        : null;
  return {
    provedor,
    modelo,
    chave:
      s.chave_cifrada && o.mestra ? decifrarChave(s.chave_cifrada, o.mestra, uid) : null,
    baseUrl,
    preco: {
      entrada:
        mesmo && s.preco_entrada !== null
          ? Number(s.preco_entrada)
          : (registro?.preco_entrada ?? null),
      saida:
        mesmo && s.preco_saida !== null
          ? Number(s.preco_saida)
          : (registro?.preco_saida ?? null),
    },
    capacidades: capacidadesDoModelo(provedor, modelo),
    guardar_original: s.guardar_original,
  };
}

/**
 * O que o market-data sabe, pelo /v1: ticker existe (`/assets/:t`) e minima e
 * maxima do pregao (`/history`, sem ajuste, que e o preco negociado).
 */
export function verificadorPorHttp(
  obter: (caminho: string) => Promise<{ status: number; corpo: unknown }>,
): Verificador {
  return {
    async tickersExistentes(tickers) {
      const r = await Promise.all(
        tickers.map(async (t) => {
          if (!/^[A-Z0-9]{4,12}$/.test(t)) return [t, 404] as const;
          return [t, (await obter(`assets/${t}`)).status] as const;
        }),
      );
      if (r.some(([, s]) => s !== 200 && s !== 404)) return null;
      return new Set(r.filter(([, s]) => s === 200).map(([t]) => t));
    },
    async faixaDoDia(ticker, data) {
      const r = await obter(
        `history/${ticker}?interval=1d&from=${data}&to=${data}&adjusted=false`,
      );
      const candles =
        r.status === 200
          ? ((
              r.corpo as {
                data?: { candles?: { date: string; low: string; high: string }[] };
              }
            ).data?.candles ?? [])
          : [];
      const c = candles.find((x) => x.date === data);
      return c ? { minima: c.low, maxima: c.high } : null;
    },
  };
}
