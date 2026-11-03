import type { IndicadorFiltravel, LinhaDoScreener } from "@bolsiq/analytics/puro";

/** De onde veio um dado e de quando e. Toda ferramenta devolve isto. */
export interface Proveniencia {
  fonte: string;
  /** Data do dado: pregao, competencia ou instante da coleta. */
  data: string;
  licenca?: string;
  /** A fonte falhou ou o dado passou do prazo de validade. */
  atrasado: boolean;
  /** Atraso tipico da fonte, em minutos (cotacao). */
  atraso_minutos?: number;
}

export interface Comprovado<T> {
  dados: T;
  proveniencia: Proveniencia[];
}

export interface FatiaResumida {
  chave: string;
  valor: string;
  fracao: number | null;
}

export interface PosicaoResumida {
  ticker: string;
  classe: string;
  setor: string;
  quantidade: string;
  preco_medio: string;
  custo_total: string;
  preco_atual: string | null;
  valor_de_mercado: string | null;
  resultado_nao_realizado: string | null;
  resultado_realizado: string;
  rentabilidade: number | null;
  proventos_recebidos: string;
}

/**
 * O que a tela /carteiras/[id] mostra, sem a serie para o grafico: o BFF monta
 * isto a partir de `painel`, entao o assistente e a tela leem os mesmos numeros.
 */
export interface CarteiraResumida {
  id: string;
  nome: string;
  patrimonio: string | null;
  custo: string;
  nao_realizado: string | null;
  nao_realizado_pct: number | null;
  realizado: string;
  proventos_12m: string;
  twr_12m: number | null;
  cdi_12m: number | null;
  ibov_12m: number | null;
  sem_cotacao: string[];
  posicoes: PosicaoResumida[];
  alocacao: Record<"classe" | "setor" | "ativo", FatiaResumida[]>;
  /** Base 100 da carteira e do IBOV nas datas dos snapshots. */
  serie: { data: string; carteira: number; ibov: number | null }[];
  recalculando: boolean;
}

export type IndicadoresDoAtivo = Partial<Record<IndicadorFiltravel, number | null>> & {
  reference_date: string;
  preco_graham?: string | null;
  preco_bazin?: string | null;
};

export type { LinhaDoScreener };
