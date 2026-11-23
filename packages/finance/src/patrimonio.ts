import { z } from "zod";
import { d, moeda } from "./decimal.js";

const Dinheiro = z.string().regex(/^-?\d+(\.\d+)?$/);

/** O que o finance sabe do patrimonio: contas, faturas e dividas. */
export interface PartesDoFinance {
  /** Soma dos saldos das contas nao arquivadas. */
  contas: string;
  /** Faturas de cartao nao pagas: compras realizadas menos estornos e pagamentos. */
  faturas: string;
  /** Saldo devedor de emprestimos e financiamentos (parcelado no cartao ja esta na fatura). */
  dividas: string;
}

/** O que vem do portfolio, ja avaliado por quem chama (ADR 0037). */
export const PartesDoPortfolio = z.object({
  renda_variavel: Dinheiro,
  renda_fixa: Dinheiro,
  fundos: Dinheiro,
  carteiras: z.array(
    z.object({ id: z.string(), nome: z.string(), valor: Dinheiro.nullable() }),
  ),
  /** Quando as cotacoes foram lidas; nulo sem carteira avaliada. */
  avaliadas_em: z.string().nullable(),
});
export type PartesDoPortfolio = z.infer<typeof PartesDoPortfolio>;

export const PORTFOLIO_VAZIO: PartesDoPortfolio = {
  renda_variavel: "0.00",
  renda_fixa: "0.00",
  fundos: "0.00",
  carteiras: [],
  avaliadas_em: null,
};

export const FATIAS_DO_PATRIMONIO = [
  "contas",
  "renda_variavel",
  "renda_fixa",
  "fundos",
  "dividas",
] as const;
export type FatiaDoPatrimonio = (typeof FATIAS_DO_PATRIMONIO)[number];

export const ROTULO_DA_FATIA: Record<FatiaDoPatrimonio, string> = {
  contas: "Contas",
  renda_variavel: "Renda variável",
  renda_fixa: "Renda fixa",
  fundos: "Fundos",
  dividas: "Dívidas",
};

export const Patrimonio = z.object({
  patrimonio_liquido: Dinheiro,
  ativos: Dinheiro,
  passivos: Dinheiro,
  contas: Dinheiro,
  renda_variavel: Dinheiro,
  renda_fixa: Dinheiro,
  fundos: Dinheiro,
  faturas: Dinheiro,
  /** Emprestimos e financiamentos. */
  dividas: Dinheiro,
  composicao: z.array(
    z.object({
      fatia: z.enum(FATIAS_DO_PATRIMONIO),
      rotulo: z.string(),
      /** Positivo nos ativos; dividas (faturas + emprestimos) negativas. */
      valor: Dinheiro,
      /** Fatia sobre os ativos, em %; nulo sem ativo. */
      percentual: z.number().nullable(),
    }),
  ),
  carteiras: PartesDoPortfolio.shape.carteiras,
  carteiras_avaliadas_em: z.string().nullable(),
});
export type Patrimonio = z.infer<typeof Patrimonio>;

/**
 * Patrimonio liquido = contas + carteiras - faturas em aberto - saldo devedor
 * de emprestimos e financiamentos. Conta no negativo (cheque especial) entra
 * como esta: reduz os ativos.
 */
export function comporPatrimonio(f: PartesDoFinance, p: PartesDoPortfolio): Patrimonio {
  const ativos = d(f.contas).plus(p.renda_variavel).plus(p.renda_fixa).plus(p.fundos);
  const passivos = d(f.faturas).plus(f.dividas);
  const fatias: Record<FatiaDoPatrimonio, string> = {
    contas: moeda(d(f.contas)),
    renda_variavel: moeda(d(p.renda_variavel)),
    renda_fixa: moeda(d(p.renda_fixa)),
    fundos: moeda(d(p.fundos)),
    dividas: moeda(passivos.neg()),
  };
  return {
    patrimonio_liquido: moeda(ativos.minus(passivos)),
    ativos: moeda(ativos),
    passivos: moeda(passivos),
    contas: fatias.contas,
    renda_variavel: fatias.renda_variavel,
    renda_fixa: fatias.renda_fixa,
    fundos: fatias.fundos,
    faturas: moeda(d(f.faturas)),
    dividas: moeda(d(f.dividas)),
    composicao: FATIAS_DO_PATRIMONIO.map((fatia) => ({
      fatia,
      rotulo: ROTULO_DA_FATIA[fatia],
      valor: fatias[fatia],
      percentual:
        fatia === "dividas" || ativos.lte(0)
          ? null
          : Number(d(fatias[fatia]).div(ativos).times(100).toFixed(1)),
    })),
    carteiras: p.carteiras,
    carteiras_avaliadas_em: p.avaliadas_em,
  };
}

/** (renda - despesas) / renda, em %. Nulo sem renda no mes. */
export function taxaDePoupanca(renda: string, despesas: string): number | null {
  if (d(renda).lte(0)) return null;
  return Number(d(renda).minus(despesas).div(renda).times(100).toFixed(1));
}

/** Mes anterior a `hoje`, `YYYY-MM`. */
export function mesAnteriorA(hoje: string): string {
  const [a, m] = hoje.slice(0, 7).split("-").map(Number) as [number, number];
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

/** Ponto da evolucao; `parcial` e o mes corrente, ao vivo, ainda sem foto. */
export const PontoDaEvolucao = z.object({
  mes: z.string().regex(/^\d{4}-\d{2}$/),
  patrimonio_liquido: Dinheiro,
  contas: Dinheiro,
  investimentos: Dinheiro,
  dividas: Dinheiro,
  parcial: z.boolean(),
});

/** Resposta de GET /api/financas/painel-geral (ADR 0037). */
export const PainelGeral = z.object({
  hoje: z.string(),
  patrimonio: Patrimonio,
  /** Ativos abertos sem cotacao agora: fora da soma, como na carteira. */
  sem_cotacao: z.array(z.string()),
  evolucao: z.array(PontoDaEvolucao),
  mes: z.object({
    competencia: z.string().regex(/^\d{4}-\d{2}$/),
    renda: Dinheiro,
    despesas: Dinheiro,
    /** (renda - despesas) / renda, em %; nulo sem renda. */
    taxa_de_poupanca: z.number().nullable(),
    /** Aportes do mes (categoria de investimento), fora das despesas. */
    investido: Dinheiro,
  }),
  capacidade: z
    .object({
      capacidade_mensal: Dinheiro,
      sobra_media: Dinheiro,
      aumento_das_parcelas: Dinheiro,
      separar_para_reserva: Dinheiro,
      meses_de_referencia: z.array(z.string()),
    })
    .nullable(),
  metas: z.array(
    z.object({
      id: z.string(),
      nome: z.string(),
      valor_alvo: Dinheiro,
      valor_atual: Dinheiro,
      progresso: z.number(),
      data_alvo: z.string(),
      fonte: z.enum(["manual", "conta", "carteira"]),
      valor_mensal_necessario: Dinheiro,
    }),
  ),
});
export type PainelGeral = z.infer<typeof PainelGeral>;
