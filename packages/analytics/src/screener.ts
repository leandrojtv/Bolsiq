import { z } from "zod";

/** Indicadores filtraveis. Nome igual ao da coluna em analytics.indicators. */
export const IndicadorFiltravel = z.enum([
  "pl",
  "pvp",
  "ev_ebitda",
  "ev_ebit",
  "p_receita",
  "dy_12m",
  "dy_medio_5a",
  "roe",
  "roic",
  "roa",
  "margem_bruta",
  "margem_ebitda",
  "margem_liquida",
  "dl_ebitda",
  "dl_pl",
  "liquidez_corrente",
  "cagr_receita_5a",
  "cagr_lucro_5a",
  "margem_graham",
  "margem_bazin",
  "volatilidade_anual",
  "drawdown_maximo",
  "sharpe",
  "beta",
  "liquidez_diaria",
]);
export type IndicadorFiltravel = z.infer<typeof IndicadorFiltravel>;

export const Faixa = z
  .object({ min: z.number().optional(), max: z.number().optional() })
  .refine((f) => f.min !== undefined || f.max !== undefined, {
    message: "informe min, max ou os dois",
  })
  .refine((f) => f.min === undefined || f.max === undefined || f.min <= f.max, {
    message: "min nao pode ser maior que max",
  });

export const FiltroDeScreener = z.object({
  faixas: z.record(IndicadorFiltravel, Faixa).default({}),
  setores: z.array(z.string().min(1)).optional(),
  tipos: z.array(z.enum(["stock", "fii", "bdr", "etf", "fund"])).optional(),
  /** Volume financeiro medio diario minimo, em reais. */
  liquidez_minima: z.number().nonnegative().optional(),
  ordenar_por: IndicadorFiltravel.default("pl"),
  ordem: z.enum(["asc", "desc"]).default("asc"),
  /**
   * Incluir ativos cujo indicador de ordenacao e indefinido.
   *
   * Padrao false: empresa sem lucro nao tem P/L, e devolve-la no topo de uma
   * ordenacao por P/L crescente seria o pior resultado possivel.
   */
  incluir_indefinidos: z.boolean().default(false),
  limite: z.number().int().positive().max(1000).default(100),
  deslocamento: z.number().int().nonnegative().default(0),
});
export type FiltroDeScreener = z.infer<typeof FiltroDeScreener>;

/**
 * Presets. Sao filtros nomeados, nao recomendacao: cada um e o criterio
 * publicado pelo autor do metodo, com os numeros que ele usou.
 */
export const presets = {
  graham: {
    descricao:
      "Acoes negociadas abaixo do preco justo de Graham, com lucro e patrimonio positivos",
    filtro: {
      faixas: {
        margem_graham: { min: 0.2 },
        pl: { min: 0, max: 15 },
        pvp: { min: 0, max: 1.5 },
      },
      tipos: ["stock"],
      ordenar_por: "margem_graham",
      ordem: "desc",
    },
  },
  bazin: {
    descricao: "Dividendo medio de 5 anos acima de 6% sobre o preco atual",
    filtro: {
      faixas: { dy_medio_5a: { min: 0.06 }, margem_bazin: { min: 0 } },
      tipos: ["stock", "fii"],
      ordenar_por: "dy_medio_5a",
      ordem: "desc",
    },
  },
  magic_formula: {
    descricao: "Greenblatt: melhor combinacao de EV/EBIT baixo com ROIC alto",
    filtro: {
      faixas: { ev_ebit: { min: 0, max: 12 }, roic: { min: 0.15 } },
      tipos: ["stock"],
      ordenar_por: "roic",
      ordem: "desc",
    },
  },
  dividendos_consistentes: {
    descricao: "Dividendo alto com endividamento sob controle e lucro crescente",
    filtro: {
      faixas: {
        dy_medio_5a: { min: 0.05 },
        dl_ebitda: { max: 3 },
        cagr_lucro_5a: { min: 0 },
        liquidez_corrente: { min: 1 },
      },
      ordenar_por: "dy_medio_5a",
      ordem: "desc",
    },
  },
} as const satisfies Record<string, { descricao: string; filtro: unknown }>;

export type NomeDePreset = keyof typeof presets;

export function filtroDoPreset(nome: NomeDePreset): FiltroDeScreener {
  return FiltroDeScreener.parse(presets[nome].filtro);
}
