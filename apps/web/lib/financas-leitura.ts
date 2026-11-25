import "server-only";
import { and, eq, sql } from "drizzle-orm";
import {
  apagarArquivosDoJob,
  ErroDeImportacao,
  extratoDaLeitura,
  schema,
  type ResultadoDaLeituraFinancas,
} from "@bolsiq/assistant";
import { comoUsuario } from "@bolsiq/portfolio";
import type {
  ImportacaoComLinhas,
  JobDeLeitura,
  LeituraDeFatura,
  NovaImportacao,
} from "@bolsiq/finance";
import { banco } from "./analytics";
import { destinoSugerido, novaImportacaoDeExtratos } from "./financas";
import {
  criarJobDeFinancas,
  lerJob,
  lerResultadoDoArquivo,
  ultimoJob,
} from "./importacao-ia";
import type { ArquivoEnviado } from "./importacao-ia";

/**
 * Fatura e extrato em PDF ou imagem no Bolsiq Financas (ADR 0040). O job e o da
 * importacao com IA (assistente, portfolio-worker, SSE, cancelamento, BYOK,
 * limite de custo); o resultado vira `ExtratoLido` e entra na revisao de sempre.
 */

const { extractions } = schema;

export const lerLeitura = async (uid: string, job: string): Promise<JobDeLeitura> =>
  paraTela(await exigirDoFinancas(uid, job));

export async function ultimaLeitura(uid: string): Promise<JobDeLeitura | null> {
  const j = await ultimoJob(uid, null);
  return j ? paraTela(j) : null;
}

export const novaLeitura = (
  uid: string,
  arquivos: ArquivoEnviado[],
  o: { modelo?: string; aceitar_imagem: boolean },
) => criarJobDeFinancas(uid, arquivos, o);

async function exigirDoFinancas(uid: string, job: string) {
  const j = await lerJob(uid, job);
  if (j.documento !== "financas")
    throw new ErroDeImportacao("job_nao_encontrado", "Leitura não encontrada.", 404);
  return j;
}

const paraTela = (j: Awaited<ReturnType<typeof lerJob>>): JobDeLeitura => ({
  id: j.id,
  status: j.status,
  estimativa: j.estimativa,
  erro: j.erro,
  criado_em: String(j.criado_em),
  arquivos: j.arquivos.map((a) => ({
    indice: a.indice,
    nome: a.nome,
    estado: a.estado,
    progresso: a.progresso,
    estrategia: a.estrategia,
    erro: a.erro,
    tem_resultado: a.tem_resultado,
    tem_arquivo: a.tem_arquivo,
  })),
});

async function resultado(uid: string, job: string, indice: number) {
  const j = await exigirDoFinancas(uid, job);
  const a = j.arquivos.find((x) => x.indice === indice);
  if (!a)
    throw new ErroDeImportacao("arquivo_nao_encontrado", "Arquivo não encontrado.", 404);
  const r = (await lerResultadoDoArquivo(
    uid,
    job,
    indice,
  )) as unknown as ResultadoDaLeituraFinancas;
  if (r.documento !== "financas")
    throw new ErroDeImportacao("sem_resultado", "Este arquivo não é uma fatura.", 404);
  return { nome: a.nome, r, extrato: extratoDaLeitura(r) };
}

export async function leituraDoArquivo(
  uid: string,
  job: string,
  indice: number,
): Promise<LeituraDeFatura> {
  const { nome, r, extrato } = await resultado(uid, job, indice);
  const { sugestao } = await destinoSugerido(uid, [{ nome, extrato }]);
  return {
    nome,
    atalho: r.atalho,
    tipo: extrato.tipo ?? "cartao",
    banco: extrato.banco,
    final_cartao: extrato.conta,
    vencimento: extrato.vencimento ?? null,
    fechamento: extrato.fechamento ?? null,
    total_informado: extrato.total_informado ?? null,
    linhas: extrato.linhas.length,
    rejeitadas: r.validacao.rejeicoes.map((x) => ({
      motivo: x.motivo,
      trecho: x.linha.origem.trecho_original.slice(0, 200),
    })),
    avisos: extrato.avisos,
    sugestao,
  };
}

/**
 * A revisao de sempre com as linhas lidas. Depois, o arquivo do job sai do
 * banco (o resultado fica, para a tela voltar) e a extracao e marcada como
 * usada, como na confirmacao da carteira.
 */
export async function revisarLeitura(
  uid: string,
  job: string,
  indice: number,
  pedido: NovaImportacao,
): Promise<ImportacaoComLinhas> {
  const { nome, r, extrato } = await resultado(uid, job, indice);
  const importacao = await novaImportacaoDeExtratos(
    uid,
    pedido,
    [{ nome, extrato }],
    r.extracao_id,
  );
  await comoUsuario(banco(), uid, (tx) =>
    tx
      .update(extractions)
      .set({ confirmado_em: sql`now()` })
      .where(and(eq(extractions.id, r.extracao_id), eq(extractions.user_id, uid))),
  );
  await apagarArquivosDoJob(banco(), uid, job);
  return importacao;
}
