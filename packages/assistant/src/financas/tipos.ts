import type { Comprovado } from "../tipos.js";

/**
 * Tipos das ferramentas financeiras. Valores em reais como string decimal
 * (`numeric` do banco), datas em YYYY-MM-DD, meses em YYYY-MM.
 */

export interface LancamentoFinanceiro {
  id: string;
  data: string;
  descricao: string;
  valor: string;
  tipo: "receita" | "despesa" | "transferencia";
  status: "realizado" | "previsto" | "conciliado";
  categoria: string | null;
  essencial: boolean;
  tipo_custo: "fixo" | "variavel" | null;
  /** Investimento (aporte): nao e gasto, e poupanca. */
  aporte: boolean;
  /** Conta ou cartao. */
  origem: string | null;
  parcela: boolean;
}

export interface ResumoDoMes {
  competencia: string;
  renda: { prevista: string; recebida: string };
  despesas: { pagas: string; a_pagar: string; total: string };
  fixos: { valor: string; percentual_da_renda: number | null };
  variaveis: { valor: string; percentual_da_renda: number | null };
  saldo_previsto_fim_do_mes: string;
  comprometido_parcelas: string;
  orcamento: {
    planejado: string;
    consumo: string;
    percentual: number | null;
    estado: "ok" | "atencao" | "estourado";
  };
}

export interface FluxoFinanceiro {
  saldo_inicial: string;
  meses: { mes: string; entradas: string; saidas: string; saldo_final: string }[];
  primeiro_mes_negativo: string | null;
}

export interface PlanoFinanceiro {
  descricao: string;
  origem: "cartao" | "emprestimo" | "financiamento";
  parcelas_restantes: number;
  valor_restante: string;
  proxima: { numero: number; data: string; valor: string } | null;
}

export interface ParcelasFuturas {
  planos: PlanoFinanceiro[];
  por_mes: { mes: string; total: string }[];
}

export interface AssinaturaFinanceira {
  nome: string;
  frequencia: "mensal" | "anual";
  valor_atual: string;
  valor_mensal: string;
  valor_anual: string;
  proxima: string;
  categoria: string | null;
  reajuste: { de: string; para: string; percentual: number } | null;
  duplicidade: boolean;
  nova: boolean;
}

export interface InsightFinanceiro {
  id: string;
  tipo: string;
  titulo: string;
  descricao: string;
  impacto_mensal: string;
  impacto_anual: string;
  severidade: "alta" | "media" | "baixa" | "info";
  acao_sugerida: string;
  /** A maior parte das evidencias esta em categoria essencial. */
  essencial: boolean;
}

/**
 * De onde as ferramentas financeiras leem, ja presas ao usuario logado (RLS):
 * o modelo nunca escolhe o dono. O BFF e o worker implementam com
 * `packages/finance` (`fontesFinanceirasDoBanco`); o eval, em memoria.
 */
export interface FontesFinanceiras {
  resumoDoMes(competencia: string): Promise<Comprovado<ResumoDoMes>>;
  /** Lancamentos com `data` no intervalo, sem pagamento de fatura duplicado. */
  lancamentos(de: string, ate: string): Promise<Comprovado<LancamentoFinanceiro[]>>;
  fluxo(meses: number): Promise<Comprovado<FluxoFinanceiro>>;
  parcelas(): Promise<Comprovado<ParcelasFuturas>>;
  assinaturas(): Promise<
    Comprovado<{
      assinaturas: AssinaturaFinanceira[];
      total_mensal: string;
      total_anual: string;
    }>
  >;
  /** Insights visiveis do mes (padrao: o de hoje), do motor do ADR 0035. */
  insights(mes?: string): Promise<Comprovado<InsightFinanceiro[]>>;
}
