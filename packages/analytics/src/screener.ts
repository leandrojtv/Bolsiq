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
  "patrimonio_liquido",
  "cotistas",
]);
export type IndicadorFiltravel = z.infer<typeof IndicadorFiltravel>;

/**
 * Indicadores de balanco: so acao tem. Em FII, ETF e BDR sao sempre nulos.
 *
 * O screener usa isto na ordenacao: ordenar por P/L descarta a acao sem P/L
 * (prejuizo), mas nao deve sumir com todo FII, que nunca tera P/L. P/VP entra
 * aqui enquanto nao ha valor patrimonial de FII na base.
 */
export const SO_DE_ACOES: ReadonlySet<IndicadorFiltravel> = new Set<IndicadorFiltravel>([
  "pl",
  "pvp",
  "ev_ebitda",
  "ev_ebit",
  "p_receita",
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
]);

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
      "Ações negociadas abaixo do preço justo de Graham, com lucro e patrimônio positivos",
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
    descricao: "Dividendo médio de 5 anos acima de 6% sobre o preço atual",
    filtro: {
      faixas: { dy_medio_5a: { min: 0.06 }, margem_bazin: { min: 0 } },
      tipos: ["stock", "fii"],
      ordenar_por: "dy_medio_5a",
      ordem: "desc",
    },
  },
  magic_formula: {
    descricao: "Greenblatt: melhor combinação de EV/EBIT baixo com ROIC alto",
    filtro: {
      faixas: { ev_ebit: { min: 0, max: 12 }, roic: { min: 0.15 } },
      tipos: ["stock"],
      ordenar_por: "roic",
      ordem: "desc",
    },
  },
  fii_desconto: {
    descricao:
      "FIIs negociados abaixo do valor patrimonial (P/VP < 1) com DY 12m acima de 8%",
    filtro: {
      faixas: { pvp: { min: 0, max: 1 }, dy_12m: { min: 0.08 } },
      tipos: ["fii"],
      ordenar_por: "dy_12m",
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

export type FormatoDoIndicador = "razao" | "percentual" | "moeda" | "quantidade";

/** Rotulo e formato de exibicao de cada indicador filtravel. */
export const INDICADORES: Record<
  IndicadorFiltravel,
  { rotulo: string; formato: FormatoDoIndicador }
> = {
  pl: { rotulo: "P/L", formato: "razao" },
  pvp: { rotulo: "P/VP", formato: "razao" },
  ev_ebitda: { rotulo: "EV/EBITDA", formato: "razao" },
  ev_ebit: { rotulo: "EV/EBIT", formato: "razao" },
  p_receita: { rotulo: "P/Receita", formato: "razao" },
  dy_12m: { rotulo: "DY 12m", formato: "percentual" },
  dy_medio_5a: { rotulo: "DY médio 5a", formato: "percentual" },
  roe: { rotulo: "ROE", formato: "percentual" },
  roic: { rotulo: "ROIC", formato: "percentual" },
  roa: { rotulo: "ROA", formato: "percentual" },
  margem_bruta: { rotulo: "Margem bruta", formato: "percentual" },
  margem_ebitda: { rotulo: "Margem EBITDA", formato: "percentual" },
  margem_liquida: { rotulo: "Margem líquida", formato: "percentual" },
  dl_ebitda: { rotulo: "DL/EBITDA", formato: "razao" },
  dl_pl: { rotulo: "DL/PL", formato: "razao" },
  liquidez_corrente: { rotulo: "Liquidez corrente", formato: "razao" },
  cagr_receita_5a: { rotulo: "CAGR receita 5a", formato: "percentual" },
  cagr_lucro_5a: { rotulo: "CAGR lucro 5a", formato: "percentual" },
  margem_graham: { rotulo: "Margem Graham", formato: "percentual" },
  margem_bazin: { rotulo: "Margem Bazin", formato: "percentual" },
  volatilidade_anual: { rotulo: "Volatilidade", formato: "percentual" },
  drawdown_maximo: { rotulo: "Drawdown máx.", formato: "percentual" },
  sharpe: { rotulo: "Sharpe", formato: "razao" },
  beta: { rotulo: "Beta", formato: "razao" },
  liquidez_diaria: { rotulo: "Liquidez diária", formato: "moeda" },
  patrimonio_liquido: { rotulo: "Patrimônio líquido", formato: "moeda" },
  cotistas: { rotulo: "Cotistas", formato: "quantidade" },
};

/** Nome legivel de cada preset, para os cards. */
export const NOME_DO_PRESET: Record<NomeDePreset, string> = {
  graham: "Graham",
  bazin: "Bazin",
  magic_formula: "Magic Formula",
  fii_desconto: "FIIs descontados",
  dividendos_consistentes: "Dividendos consistentes",
};
