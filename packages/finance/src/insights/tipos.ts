import type { StatusDeLancamento, TipoDeConta, TipoDeLancamento } from "../tipos.js";

/**
 * Insights do Bolsiq Financas (ADR 0035). Calculados no codigo, de forma
 * deterministica: cada um aponta os lancamentos que o geraram. A IA so explica
 * e prioriza o que ja foi calculado aqui.
 */

export const TIPOS_DE_INSIGHT = [
  "assinatura",
  "tarifas",
  "formiga",
  "fora_do_padrao",
  "transacao_atipica",
  "essencial_superfluo",
  "ranking",
] as const;
export type TipoDeInsight = (typeof TIPOS_DE_INSIGHT)[number];

export const ROTULO_DO_TIPO: Record<TipoDeInsight, string> = {
  assinatura: "Assinaturas",
  tarifas: "Tarifas e juros",
  formiga: "Efeito formiga",
  fora_do_padrao: "Fora do padrão",
  transacao_atipica: "Compra atípica",
  essencial_superfluo: "Essencial x supérfluo",
  ranking: "Onde você mais gasta",
};

/** `info` nao tem economia a propor: fica no fim e fora do "Onde otimizar". */
export const SEVERIDADES = ["alta", "media", "baixa", "info"] as const;
export type Severidade = (typeof SEVERIDADES)[number];

export const ACOES_DE_FEEDBACK = [
  "dispensado",
  "ainda_uso",
  "vou_cancelar",
  "ja_cancelei",
] as const;
export type AcaoDeFeedback = (typeof ACOES_DE_FEEDBACK)[number];

export interface Periodo {
  inicio: string;
  fim: string;
}

export interface Insight {
  /** Deterministico: o mesmo achado tem o mesmo id em todo recalculo. */
  id: string;
  tipo: TipoDeInsight;
  titulo: string;
  descricao: string;
  impacto_mensal: string;
  impacto_anual: string;
  severidade: Severidade;
  /** ids dos lancamentos que geraram o insight. */
  evidencias: string[];
  acao_sugerida: string;
  periodo: Periodo;
  /** Numeros do detector para a tela (ranking, flags da assinatura etc.). */
  dados: Record<string, unknown>;
}

/** O que os detectores leem de cada lancamento. */
export interface LancamentoDeInsight {
  id: string;
  tipo: TipoDeLancamento;
  status: StatusDeLancamento;
  valor: string;
  data: string;
  competencia: string;
  descricao: string;
  descricao_normalizada: string;
  category_id: string | null;
  account_id: string | null;
  card_id: string | null;
  transferencia_sentido: "saida" | "entrada" | null;
  /** Tipo da conta do lancamento (transferencia para poupanca e aporte). */
  conta_tipo: TipoDeConta | null;
  /** Parcela de um plano: mesmo valor todo mes, mas nao e assinatura. */
  parcelado: boolean;
}

export interface CategoriaDeInsight {
  id: string;
  nome: string;
  natureza: "receita" | "despesa";
  tipo_custo: "fixo" | "variavel";
  essencial: boolean;
  sistema: boolean;
}

export interface Configuracao {
  /** Efeito formiga: despesa variavel abaixo deste valor. */
  limite_formiga: string;
  /** Referencia de essenciais, nao essenciais e poupanca, em % da renda. */
  referencia: { essenciais: number; nao_essenciais: number; poupanca: number };
}

export const CONFIGURACAO_PADRAO: Configuracao = {
  limite_formiga: "50.00",
  referencia: { essenciais: 50, nao_essenciais: 30, poupanca: 20 },
};

export interface Contexto {
  lancamentos: LancamentoDeInsight[];
  categorias: Map<string, CategoriaDeInsight>;
  /** Mes de referencia, YYYY-MM. */
  mes: string;
  /** Hoje em Sao Paulo, YYYY-MM-DD. */
  hoje: string;
  config: Configuracao;
}

/** Motivo do evento `finance.insight.novo.v1` (o Prompt 8 transforma em alerta). */
export type Novidade = "assinatura_nova" | "reajuste" | "tarifa_nova";
