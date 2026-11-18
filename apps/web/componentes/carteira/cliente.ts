import { api } from "@/lib/api";
import {
  TERMINAIS,
  type EstadoDaImportacaoIA,
  type JobNaTela,
  type LinhaEditada,
  type ResultadoNaTela,
} from "@/lib/importacao-ia-modelo";
import type { Atalho } from "@bolsiq/assistant/puro";
import type { NovaTransacao } from "@/lib/carteira-modelo";
import type { PainelDaCarteira, RelatorioNaTela } from "@/lib/carteira";
import type { DecisaoDeDivergencia, RevisaoDeCarga } from "@bolsiq/portfolio";

const json = (method: string, corpo: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(corpo),
});

export const chaveDoPainel = (id: string) => ["carteira", id] as const;

export const lerPainel = (id: string) =>
  api<{ data: PainelDaCarteira }>(`carteiras/${id}`).then((r) => r.data);

export const criarCarteira = (nome: string) =>
  api<{ data: { id: string; nome: string } }>("carteiras", json("POST", { nome })).then(
    (r) => r.data,
  );

export const adicionarTransacao = (id: string, t: NovaTransacao) =>
  api<{ data: { id: string } }>(`carteiras/${id}/transacoes`, json("POST", t));

export type FormatoDeImportacao = "bolsiq" | "b3" | "posicao_bolsiq";

export function importarArquivo(
  id: string,
  arquivo: File,
  formato: FormatoDeImportacao,
  decisoes: DecisaoDeDivergencia[] = [],
) {
  const form = new FormData();
  form.set("arquivo", arquivo);
  form.set("formato", formato);
  form.set("decisoes", JSON.stringify(decisoes));
  return api<{ data: RelatorioNaTela }>(`carteiras/${id}/importacoes`, {
    method: "POST",
    body: form,
  }).then((r) => r.data);
}

export function revisarPosicao(id: string, arquivo: File) {
  const form = new FormData();
  form.set("arquivo", arquivo);
  return api<{ data: RevisaoDeCarga }>(`carteiras/${id}/importacoes/revisao`, {
    method: "POST",
    body: form,
  }).then((r) => r.data);
}

// ---------------------------------------------------------------------------
// Importacao com IA
// ---------------------------------------------------------------------------

export const lerEstadoDaImportacaoIA = () =>
  api<{ data: EstadoDaImportacaoIA }>("assistente/importacao").then((r) => r.data);

export const consentirImportacaoIA = (guardar_original: boolean) =>
  api<{ data: EstadoDaImportacaoIA }>(
    "assistente/importacao",
    json("POST", { guardar_original }),
  ).then((r) => r.data);

export interface EnvioDaIA {
  arquivos: { arquivo: File; corretora: string }[];
  texto: string;
  corretora_do_texto: string;
  senhas: Record<string, string>;
  modelo?: string;
  aceitar_imagem: boolean;
}

/** Cria o job; o worker processa. CSV ja no layout volta em `atalhos`. */
export function enviarParaIA(id: string, e: EnvioDaIA) {
  const form = new FormData();
  for (const a of e.arquivos) form.append("arquivos", a.arquivo);
  if (e.texto.trim()) form.set("texto", e.texto);
  form.set(
    "corretoras",
    JSON.stringify([...e.arquivos.map((a) => a.corretora), e.corretora_do_texto]),
  );
  form.set("senhas", JSON.stringify(e.senhas));
  if (e.modelo) form.set("modelo", e.modelo);
  form.set("aceitar_imagem", e.aceitar_imagem ? "true" : "false");
  return api<{
    data: { job_id: string | null; atalhos: { nome: string; atalho: Atalho }[] };
  }>(`carteiras/${id}/importacoes/ia/jobs`, { method: "POST", body: form }).then(
    (r) => r.data,
  );
}

export const ultimoJobDaIA = (id: string) =>
  api<{ data: JobNaTela | null }>(`carteiras/${id}/importacoes/ia/jobs`).then(
    (r) => r.data,
  );

/** Progresso por SSE. Devolve a funcao que fecha a conexao. */
export function acompanharJob(
  id: string,
  job: string,
  aoMudar: (j: JobNaTela) => void,
): () => void {
  const fonte = new EventSource(
    `/api/carteiras/${id}/importacoes/ia/jobs/${job}/eventos`,
  );
  fonte.onmessage = (ev: MessageEvent<string>) => {
    const j = JSON.parse(ev.data) as JobNaTela;
    aoMudar(j);
    if (TERMINAIS.includes(j.status)) fonte.close();
  };
  return () => fonte.close();
}

export const resultadoDoArquivo = (id: string, job: string, indice: number) =>
  api<{ data: ResultadoNaTela }>(
    `carteiras/${id}/importacoes/ia/jobs/${job}/arquivos/${indice}`,
  ).then((r) => r.data);

export const confirmarCustoDaIA = (id: string, job: string) =>
  api<null>(`carteiras/${id}/importacoes/ia/jobs/${job}/confirmar`, { method: "POST" });

export const cancelarJobDaIA = (id: string, job: string) =>
  api<null>(`carteiras/${id}/importacoes/ia/jobs/${job}/cancelar`, { method: "POST" });

export const reprocessarNaIA = (
  id: string,
  job: string,
  corpo: { indice: number; lotes?: number[]; modelo?: string },
) =>
  api<null>(
    `carteiras/${id}/importacoes/ia/jobs/${job}/reprocessar`,
    json("POST", corpo),
  );

export const revisarIA = (id: string, extracao_id: string, linhas: LinhaEditada[]) =>
  api<{ data: RevisaoDeCarga | null }>(
    `carteiras/${id}/importacoes/ia/revisao`,
    json("POST", { extracao_id, linhas }),
  ).then((r) => r.data);

export const confirmarIA = (
  id: string,
  corpo: {
    extracao_id: string;
    job_id?: string;
    linhas: LinhaEditada[];
    decisoes: DecisaoDeDivergencia[];
    aceitar_nao_conciliada: boolean;
  },
) =>
  api<{ data: RelatorioNaTela }>(
    `carteiras/${id}/importacoes/ia/confirmar`,
    json("POST", corpo),
  ).then((r) => r.data);
