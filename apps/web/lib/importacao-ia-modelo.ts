import { z } from "zod";
import {
  conciliar,
  type ConciliacaoDaCorretora,
  type EstadoDoArquivo,
  type Estimativa,
  type Estrategia,
  type GrupoDaLinha,
  type LinhaProposta,
  type Progresso,
  type ResultadoDaImportacaoComIA,
  type StatusDoJob,
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
  /** O job de onde a extracao veio: o arquivo dele sai do servidor na confirmacao. */
  job_id: z.string().uuid().optional(),
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
  aceitar_imagem: z.enum(["true", "false"]).default("false"),
  /** Corretora de cada arquivo, na ordem dos arquivos (JSON). */
  corretoras: z.array(z.string().max(60)).max(50).default([]),
  /** Senha de PDF por nome de arquivo (JSON). Nao e gravada. */
  senhas: z.record(z.string().max(200), z.string().max(200)).default({}),
});

export const PedidoDeReprocessamento = z.object({
  indice: z.number().int().min(0),
  lotes: z.array(z.number().int().min(0)).max(500).optional(),
  modelo: z.string().trim().max(200).optional(),
});

export interface EstadoDaImportacaoIA {
  configurado: boolean;
  provedor: string | null;
  modelo: string | null;
  /** Ha modelo configurado: qualquer modelo de texto importa (ADR 0027). */
  pode_importar: boolean;
  /** O modelo le imagem: pagina escaneada vai como imagem; senao, OCR local. */
  visao: boolean;
  consentiu: boolean;
  guardar_original: boolean;
  limite_diario: number;
  feitas_hoje: number;
  /** Outros modelos do mesmo provedor, para reprocessar. */
  modelos: { modelo: string; visao: boolean; homologado: boolean }[];
  limites: { mb: number; paginas: number; arquivos: number; confirmar_acima_usd: number };
}

export type ResultadoNaTela = ResultadoDaImportacaoComIA;

export interface ArquivoDoJobNaTela {
  indice: number;
  nome: string;
  corretora: string | null;
  estado: EstadoDoArquivo;
  progresso: Progresso | null;
  estrategia: Estrategia | null;
  estimativa: Estimativa | null;
  erro: string | null;
  tem_resultado: boolean;
  /** O arquivo ainda esta no servidor: da para reprocessar. */
  tem_arquivo: boolean;
}

export interface JobNaTela {
  id: string;
  carteira_id: string;
  status: StatusDoJob;
  estimativa: { custo_estimado: string | null } | null;
  erro: string | null;
  criado_em: string;
  arquivos: ArquivoDoJobNaTela[];
}

export const TERMINAIS: StatusDoJob[] = ["pronto", "falhou", "cancelado"];

export const ROTULO_DO_ESTADO: Record<EstadoDoArquivo, string> = {
  pendente: "Na fila",
  lendo: "Lendo o arquivo",
  ocr: "Lendo páginas escaneadas (OCR)",
  analisando: "IA",
  corrigindo: "Corrigindo",
  validando: "Conciliando",
  pronto: "Pronto",
  falhou: "Falhou",
  cancelado: "Cancelado",
};

export const ROTULO_DA_ESTRATEGIA: Record<Estrategia, string> = {
  texto: "texto",
  visao: "páginas como imagem (visão)",
  ocr: "OCR local",
};

/** "IA lote 2 de 5, 37 linhas", "Corrigindo (rodada 1 de 2)". */
export function textoDoProgresso(
  a: Pick<ArquivoDoJobNaTela, "estado" | "progresso">,
): string {
  const p = a.progresso;
  const base = ROTULO_DO_ESTADO[a.estado];
  if (!p || p.total === undefined) return base;
  if (a.estado === "analisando")
    return `IA lote ${p.feitos ?? 0} de ${p.total}${p.linhas ? `, ${p.linhas} linhas` : ""}`;
  if (a.estado === "corrigindo")
    return `Corrigindo (rodada ${p.feitos ?? 1} de ${p.total})`;
  return base;
}

const CORRETORAS: [RegExp, string][] = [
  [/\bxp\b|xpi/i, "XP"],
  [/nubank|nu ?invest|\bnu\b/i, "Nubank"],
  [/santander/i, "Santander"],
  [/btg/i, "BTG"],
  [/ita[uú]/i, "Itaú"],
  [/\brico\b/i, "Rico"],
  [/clear/i, "Clear"],
  [/inter\b/i, "Inter"],
  [/bradesco/i, "Bradesco"],
  [/banco do brasil|\bbb\b/i, "Banco do Brasil"],
  [/caixa/i, "Caixa"],
  [/modal/i, "Modal"],
  [/genial/i, "Genial"],
  [/avenue/i, "Avenue"],
];

/** Sugestao de corretora pelo nome do arquivo; o usuario confirma. */
export function sugerirCorretora(nome: string): string {
  const limpo = nome.replace(/[_\-.[\]()]+/g, " ");
  return CORRETORAS.find(([re]) => re.test(limpo))?.[1] ?? "";
}

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

/** Campos editaveis na tela, por tipo. O campo com problema aparece sempre. */
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
    { campo: "corretora", rotulo: "Corretora" },
    { campo: "data_posicao", rotulo: "Data" },
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

/** Os campos que a linha mostra: os padrao do tipo e os que tem problema. */
export function camposDaLinha(
  l: Pick<LinhaProposta, "tipo" | "problemas">,
): { campo: string; rotulo: string }[] {
  const padrao = CAMPOS_EDITAVEIS[l.tipo];
  const extras = l.problemas
    .filter((p) => !padrao.some((c) => c.campo === p))
    .map((p) => ({ campo: p, rotulo: p.replace(/_/g, " ") }));
  return [...padrao, ...extras];
}

export const ROTULO_DO_GRUPO: Record<GrupoDaLinha, string> = {
  pronta: "Prontas",
  preenchida: "Preenchidas automaticamente",
  ajuste: "Precisam de ajuste",
  a_receber: "Proventos a receber",
};

/** Custo em dolares para a tela: "US$ 0,0021", ou "sem preço". */
export function custoNaTela(custo: string | null): string {
  if (custo === null) return "sem preço conhecido";
  const n = Number(custo);
  return `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: n < 0.01 ? 4 : 2, maximumFractionDigits: n < 0.01 ? 4 : 2 })}`;
}
