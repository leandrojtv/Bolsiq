import { z } from "zod";
import {
  conciliar,
  type Atalho,
  type ConciliacaoDaCorretora,
  type Estimativa,
  type LinhaProposta,
  type Remocoes,
  type ResultadoDaValidacao,
} from "@bolsiq/assistant/puro";

/** Importacao com IA: formularios, eventos e contas da tela, sem banco. Navegador e BFF. */

const Dados = z.record(z.string().max(60), z.string().max(400));

export const LinhaEditada = z.object({
  id: z.string().min(1).max(40),
  tipo: z.enum(["posicao", "transacao", "provento"]),
  dados: Dados,
});
export type LinhaEditada = z.infer<typeof LinhaEditada>;

export const PedidoDeRevisaoIA = z.object({
  extracao_id: z.string().uuid(),
  linhas: z.array(LinhaEditada).max(2000),
});

export const PedidoDeConfirmacaoIA = PedidoDeRevisaoIA.extend({
  decisoes: z
    .array(
      z.object({
        corretora: z.string().min(1),
        ticker: z.string().min(1),
        acao: z.enum(["gerar_ajuste", "ignorar"]),
      }),
    )
    .default([]),
  /** Carga nao conciliada so grava com este aceite explicito. */
  aceitar_nao_conciliada: z.boolean().default(false),
});
export type PedidoDeConfirmacaoIA = z.infer<typeof PedidoDeConfirmacaoIA>;

export const ConsentimentoDaImportacao = z.object({
  guardar_original: z.boolean().default(false),
});

/** Campos do multipart, alem dos arquivos e do texto colado. */
export const OpcoesDoEnvio = z.object({
  modelo: z.string().trim().max(200).optional(),
  reprocessar: z.enum(["true", "false"]).default("false"),
  aceitar_imagem: z.enum(["true", "false"]).default("false"),
});

export interface EstadoDaImportacaoIA {
  configurado: boolean;
  provedor: string | null;
  modelo: string | null;
  /** O modelo atual tem saida estruturada: sem ela, a opcao nao aparece. */
  pode_importar: boolean;
  visao: boolean;
  consentiu: boolean;
  guardar_original: boolean;
  limite_diario: number;
  feitas_hoje: number;
  /** Outros modelos do mesmo provedor que importam, para reprocessar. */
  modelos: { modelo: string; visao: boolean; homologado: boolean }[];
}

export interface EstimativaDoArquivo {
  nome: string;
  hash: string;
  atalho: Atalho | null;
  estimativa: Estimativa | null;
  /** Imagem ou pagina escaneada: vai sem anonimizacao, so com aceite. */
  precisa_visao: boolean;
  sem_texto: string[];
  remocoes: Remocoes;
  /** O mesmo arquivo ja foi extraido com este modelo: nao gasta de novo. */
  em_cache: boolean;
}

export interface ResultadoNaTela {
  extracao_id: string;
  do_cache: boolean;
  provedor: string;
  modelo: string;
  versao_prompt: string;
  uso: { tokens_entrada: number; tokens_saida: number };
  custo_estimado: string | null;
  arquivo: { nome: string; tipo: string; hash: string; paginas: number };
  remocoes: Remocoes;
  partes: { origem: string; texto: string }[];
  validacao: ResultadoDaValidacao;
}

export type Etapa = "extraindo" | "analisando" | "validando";

/** Uma linha do NDJSON que a rota de processamento devolve. */
export type EventoDaImportacao =
  | { tipo: "etapa"; arquivo: string; etapa: Etapa; detalhe?: string }
  | { tipo: "atalho"; arquivo: string; atalho: Atalho }
  | { tipo: "resultado"; arquivo: string; resultado: ResultadoNaTela }
  | { tipo: "erro"; arquivo: string; codigo: string; mensagem: string };

export const ROTULO_DA_ETAPA: Record<Etapa, string> = {
  extraindo: "Extraindo texto",
  analisando: "Analisando com IA",
  validando: "Validando",
};

/** Soma das linhas marcadas contra o total declarado, refeita a cada clique. */
export function conciliacaoDaSelecao(
  linhas: Pick<LinhaProposta, "tipo" | "dados">[],
  totais: { descricao: string; valor: string }[],
  tolerancia?: number,
): ConciliacaoDaCorretora[] {
  const porCorretora = new Map<string, string[]>();
  for (const l of linhas) {
    if (l.tipo !== "posicao") continue;
    const c = l.dados.corretora ?? "";
    porCorretora.set(c, [...(porCorretora.get(c) ?? []), l.dados.saldo_bruto ?? ""]);
  }
  return [...porCorretora.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([corretora, saldos]) => conciliar(corretora, saldos, totais, tolerancia));
}

/** Campos editaveis na tela, por tipo. O resto segue como o modelo propos. */
export const CAMPOS_EDITAVEIS: Record<
  LinhaProposta["tipo"],
  { campo: string; rotulo: string }[]
> = {
  posicao: [
    { campo: "ativo", rotulo: "Ativo" },
    { campo: "codigo", rotulo: "Código" },
    { campo: "classe", rotulo: "Classe" },
    { campo: "quantidade", rotulo: "Qtd." },
    { campo: "saldo_bruto", rotulo: "Saldo bruto" },
  ],
  transacao: [
    { campo: "data", rotulo: "Data" },
    { campo: "ticker", rotulo: "Ticker" },
    { campo: "tipo", rotulo: "Tipo" },
    { campo: "quantidade", rotulo: "Qtd." },
    { campo: "preco", rotulo: "Preço" },
    { campo: "taxas", rotulo: "Taxas" },
  ],
  provento: [
    { campo: "data", rotulo: "Data" },
    { campo: "ticker", rotulo: "Ticker" },
    { campo: "quantidade", rotulo: "Qtd." },
    { campo: "preco", rotulo: "Por cota" },
  ],
};

/** Custo em dolares para a tela: "US$ 0,0021", ou "sem preço". */
export function custoNaTela(custo: string | null): string {
  if (custo === null) return "sem preço conhecido";
  const n = Number(custo);
  return `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: n < 0.01 ? 4 : 2, maximumFractionDigits: n < 0.01 ? 4 : 2 })}`;
}
