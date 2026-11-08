import { api, ErroDaApi } from "@/lib/api";
import type {
  EstadoDaImportacaoIA,
  EstimativaDoArquivo,
  EventoDaImportacao,
  LinhaEditada,
} from "@/lib/importacao-ia-modelo";
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

function formDaIA(
  arquivos: File[],
  texto: string,
  extra: Record<string, string | undefined> = {},
) {
  const form = new FormData();
  for (const a of arquivos) form.append("arquivos", a);
  if (texto.trim()) form.set("texto", texto);
  for (const [k, v] of Object.entries(extra)) if (v) form.set(k, v);
  return form;
}

export const estimarIA = (id: string, arquivos: File[], texto: string, modelo?: string) =>
  api<{ data: EstimativaDoArquivo[] }>(`carteiras/${id}/importacoes/ia/estimativa`, {
    method: "POST",
    body: formDaIA(arquivos, texto, { modelo }),
  }).then((r) => r.data);

/** Le o NDJSON da rota e entrega cada evento assim que chega. */
export async function processarIA(
  id: string,
  arquivos: File[],
  texto: string,
  opcoes: { modelo?: string; reprocessar?: boolean; aceitar_imagem?: boolean },
  aoEvento: (e: EventoDaImportacao) => void,
): Promise<void> {
  const res = await fetch(`/api/carteiras/${id}/importacoes/ia`, {
    method: "POST",
    body: formDaIA(arquivos, texto, {
      modelo: opcoes.modelo,
      reprocessar: opcoes.reprocessar ? "true" : undefined,
      aceitar_imagem: opcoes.aceitar_imagem ? "true" : undefined,
    }),
  });
  if (!res.ok || !res.body) {
    const corpo = (await res.json().catch(() => null)) as {
      error?: { message: string };
    } | null;
    throw new ErroDaApi(res.status, corpo?.error?.message ?? `erro ${res.status}`);
  }
  const leitor = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let resto = "";
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    resto += value;
    const linhas = resto.split("\n");
    resto = linhas.pop() ?? "";
    for (const l of linhas) if (l.trim()) aoEvento(JSON.parse(l) as EventoDaImportacao);
  }
}

export const revisarIA = (id: string, extracao_id: string, linhas: LinhaEditada[]) =>
  api<{ data: RevisaoDeCarga | null }>(
    `carteiras/${id}/importacoes/ia/revisao`,
    json("POST", { extracao_id, linhas }),
  ).then((r) => r.data);

export const confirmarIA = (
  id: string,
  corpo: {
    extracao_id: string;
    linhas: LinhaEditada[];
    decisoes: DecisaoDeDivergencia[];
    aceitar_nao_conciliada: boolean;
  },
) =>
  api<{ data: RelatorioNaTela }>(
    `carteiras/${id}/importacoes/ia/confirmar`,
    json("POST", corpo),
  ).then((r) => r.data);
