import type {
  FluxoFinanceiro,
  FontesFinanceiras,
  InsightFinanceiro,
  LancamentoFinanceiro,
} from "../src/financas/tipos.js";
import type { Proveniencia } from "../src/tipos.js";

/**
 * Base de conferencia do Bolsiq Financas: julho a outubro de 2026, hoje em
 * 30/10/2026 (o mesmo HOJE de base.ts). Os valores esperados dos casos foram
 * somados a mao a partir destas linhas.
 */

const PROV: Proveniencia[] = [
  {
    fonte: "Lançamentos do usuário (Bolsiq Finanças)",
    data: "2026-10-30",
    atrasado: false,
  },
];

let seq = 0;
function l(
  data: string,
  descricao: string,
  valor: string,
  categoria: string | null,
  extra: Partial<LancamentoFinanceiro> = {},
): LancamentoFinanceiro {
  const essenciais = ["Moradia", "Mercado", "Contas da casa", "Saúde"];
  const fixas = ["Moradia", "Assinaturas", "Tarifas bancárias", "Contas da casa"];
  return {
    id: `f${String(++seq).padStart(3, "0")}`,
    data,
    descricao,
    valor,
    tipo: "despesa",
    status: "realizado",
    categoria,
    essencial: categoria !== null && essenciais.includes(categoria),
    tipo_custo:
      categoria === null ? null : fixas.includes(categoria) ? "fixo" : "variavel",
    aporte: false,
    origem: "Conta Corrente",
    parcela: false,
    ...extra,
  };
}

const MERCADO: Record<string, string> = {
  "07": "900.00",
  "08": "950.00",
  "09": "880.00",
  "10": "1100.00",
};

export const LANCAMENTOS: LancamentoFinanceiro[] = [
  ...["07", "08", "09", "10"].flatMap((m) => [
    l(`2026-${m}-05`, "Salário Empresa", "8000.00", "Salário", { tipo: "receita" }),
    l(`2026-${m}-03`, "Aluguel Apartamento", "2500.00", "Moradia"),
    l(`2026-${m}-20`, "Supermercado Bom Preço", MERCADO[m] as string, "Mercado"),
    l(`2026-${m}-10`, "Netflix.com", "44.90", "Assinaturas", { origem: "Cartão Visa" }),
    l(`2026-${m}-12`, "Notebook Loja Tech", "350.00", "Compras", {
      origem: "Cartão Visa",
      parcela: true,
    }),
    l(`2026-${m}-02`, "Tarifa Pacote Serviços", "39.90", "Tarifas bancárias"),
  ]),
  l("2026-09-08", "iFood *Burger House", "52.00", "Restaurantes e delivery"),
  l("2026-09-22", "iFood *Sushi Bar", "41.30", "Restaurantes e delivery"),
  l("2026-10-04", "iFood *Burger House", "45.90", "Restaurantes e delivery"),
  l("2026-10-11", "iFood *Pizzaria Bella", "62.50", "Restaurantes e delivery"),
  l("2026-10-25", "iFood *Sushi Bar", "38.00", "Restaurantes e delivery"),
  l("2026-09-15", "PIX ENVIADO JOAO DA SILVA", "300.00", "Outros"),
  l("2026-10-15", "PIX ENVIADO JOAO DA SILVA", "300.00", "Outros"),
  l("2026-10-06", "Aporte Tesouro Selic", "500.00", "Investimentos (aporte)", {
    aporte: true,
  }),
  l("2026-10-31", "Conta de Luz", "180.00", "Contas da casa", { status: "previsto" }),
];

/** Fluxo: 12.000 hoje, outubro so com a luz prevista, depois +2.000 por mes. */
export function fluxoDeTeste(meses: number): FluxoFinanceiro {
  let saldo = 12000;
  const lista = Array.from({ length: meses }, (_, i) => {
    const t = new Date(Date.UTC(2026, 9 + i, 1));
    const mes = t.toISOString().slice(0, 7);
    const [e, s] = i === 0 ? [0, 180] : [8000, 6000];
    saldo += e - s;
    return {
      mes,
      entradas: e.toFixed(2),
      saidas: s.toFixed(2),
      saldo_final: saldo.toFixed(2),
    };
  });
  return { saldo_inicial: "12000.00", meses: lista, primeiro_mes_negativo: null };
}

export const INSIGHTS: InsightFinanceiro[] = [
  {
    id: "assinatura-plano",
    tipo: "assinatura",
    titulo: "Assinatura: Plano de Saúde",
    descricao: "Cobrança mensal de R$ 600,00.",
    impacto_mensal: "600.00",
    impacto_anual: "7200.00",
    severidade: "baixa",
    acao_sugerida: "Confirme se ainda usa.",
    essencial: true,
  },
  {
    id: "formiga-1",
    tipo: "formiga",
    titulo: "Efeito formiga: R$ 146,40 por mês em compras pequenas",
    descricao: "iFood virou hábito.",
    impacto_mensal: "146.40",
    impacto_anual: "1756.80",
    severidade: "media",
    acao_sugerida: "Defina um teto semanal.",
    essencial: false,
  },
  {
    id: "assinatura-netflix",
    tipo: "assinatura",
    titulo: "Assinatura: Netflix.com",
    descricao: "Cobrança mensal de R$ 44,90.",
    impacto_mensal: "44.90",
    impacto_anual: "538.80",
    severidade: "baixa",
    acao_sugerida: "Confirme se ainda usa.",
    essencial: false,
  },
  {
    id: "tarifas-1",
    tipo: "tarifas",
    titulo: "R$ 478,80 em tarifas e juros em 12 meses",
    descricao: "Tarifa de pacote todo mês.",
    impacto_mensal: "39.90",
    impacto_anual: "478.80",
    severidade: "media",
    acao_sugerida: "Troque por uma conta sem tarifa.",
    essencial: false,
  },
  {
    id: "fora-mercado",
    tipo: "fora_do_padrao",
    titulo: "Mercado acima do normal neste mês",
    descricao: "Mercado somou R$ 1.100,00.",
    impacto_mensal: "200.00",
    impacto_anual: "200.00",
    severidade: "media",
    acao_sugerida: "Segure novos gastos.",
    essencial: true,
  },
];

export function fontesFinanceirasDeTeste(): FontesFinanceiras {
  const resolver = <T>(dados: T) => Promise.resolve({ dados, proveniencia: PROV });
  return {
    resumoDoMes: (competencia) =>
      resolver({
        competencia,
        renda: { prevista: "8000.00", recebida: "8000.00" },
        despesas: { pagas: "4981.20", a_pagar: "180.00", total: "5161.20" },
        fixos: { valor: "2584.80", percentual_da_renda: 32.3 },
        variaveis: { valor: "2576.40", percentual_da_renda: 32.2 },
        saldo_previsto_fim_do_mes: "11820.00",
        comprometido_parcelas: "350.00",
        orcamento: {
          planejado: "6000.00",
          consumo: "5161.20",
          percentual: 86,
          estado: "atencao" as const,
        },
      }),
    lancamentos: (de, ate) =>
      resolver(LANCAMENTOS.filter((x) => x.data >= de && x.data <= ate)),
    fluxo: (meses) => resolver(fluxoDeTeste(meses)),
    parcelas: () =>
      resolver({
        planos: [
          {
            descricao: "Notebook Loja Tech",
            origem: "cartao" as const,
            parcelas_restantes: 6,
            valor_restante: "2100.00",
            proxima: { numero: 5, data: "2026-11-12", valor: "350.00" },
          },
        ],
        por_mes: Array.from({ length: 12 }, (_, i) => ({
          mes: new Date(Date.UTC(2026, 9 + i, 1)).toISOString().slice(0, 7),
          total: i < 7 ? "350.00" : "0.00",
        })),
      }),
    assinaturas: () =>
      resolver({
        total_mensal: "44.90",
        total_anual: "538.80",
        assinaturas: [
          {
            nome: "Netflix.com",
            frequencia: "mensal" as const,
            valor_atual: "44.90",
            valor_mensal: "44.90",
            valor_anual: "538.80",
            proxima: "2026-11-10",
            categoria: "Assinaturas",
            reajuste: null,
            duplicidade: false,
            nova: false,
          },
        ],
      }),
    insights: () => resolver(INSIGHTS),
  };
}
