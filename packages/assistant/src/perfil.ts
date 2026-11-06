import { z } from "zod";
import { FiltroDeScreener, type NomeDePreset } from "@bolsiq/analytics/puro";

/** Classes da alocacao-alvo. `kind` e o tipo no screener; renda fixa nao tem. */
export const CLASSES = {
  acoes: { rotulo: "Ações", kind: "stock" },
  fiis: { rotulo: "FIIs", kind: "fii" },
  bdrs: { rotulo: "BDRs", kind: "bdr" },
  etfs: { rotulo: "ETFs", kind: "etf" },
  fundos: { rotulo: "Fundos", kind: "fund" },
  renda_fixa: { rotulo: "Renda fixa", kind: null },
} as const;
export type ClasseDoPerfil = keyof typeof CLASSES;
export const NOMES_DE_CLASSE = Object.keys(CLASSES) as ClasseDoPerfil[];

export const OBJETIVOS = {
  renda: "Renda passiva",
  crescimento: "Crescimento de patrimônio",
  preservacao: "Preservação de capital",
  aposentadoria: "Aposentadoria",
} as const;
export const HORIZONTES = {
  curto: "Até 2 anos",
  medio: "2 a 5 anos",
  longo: "Mais de 5 anos",
} as const;
export const TOLERANCIAS = { baixa: "Baixa", media: "Média", alta: "Alta" } as const;

export const METODOS = {
  graham: "Graham",
  bazin: "Bazin",
  magic_formula: "Magic Formula",
  fii_desconto: "FIIs descontados",
  dividendos_consistentes: "Dividendos consistentes",
  filtro_salvo: "Filtro salvo do screener",
} as const satisfies Record<NomeDePreset | "filtro_salvo", string>;
export type Metodo = keyof typeof METODOS;

const chaves = <T extends object>(o: T) =>
  Object.keys(o) as [Extract<keyof T, string>, ...Extract<keyof T, string>[]];

const fracao = z.number().min(0).max(1);

export const PerfilDoInvestidor = z
  .object({
    objetivo: z.enum(chaves(OBJETIVOS)),
    horizonte: z.enum(chaves(HORIZONTES)),
    tolerancia: z.enum(chaves(TOLERANCIAS)),
    /** Fracao por classe, somando 1. Classe ausente e alvo zero. */
    alocacao_alvo: z.record(z.enum(chaves(CLASSES)), fracao),
    limite_ativo: fracao.default(0.2),
    limite_setor: fracao.default(0.4),
    metodos: z.array(z.enum(chaves(METODOS))).min(1, "escolha ao menos um método"),
    filtro_salvo: FiltroDeScreener.nullable().default(null),
    evitar: z
      .array(
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z0-9]{4,12}$/, "ticker inválido"),
      )
      .max(100)
      .default([]),
    /** Volume financeiro medio diario minimo dos candidatos, em reais. */
    liquidez_minima: z.number().nonnegative().default(1_000_000),
  })
  .superRefine((p, ctx) => {
    const soma = Object.values(p.alocacao_alvo).reduce((a, b) => a + (b ?? 0), 0);
    if (Math.abs(soma - 1) > 0.001)
      ctx.addIssue({
        code: "custom",
        path: ["alocacao_alvo"],
        message: "a alocação-alvo precisa somar 100%",
      });
    if (p.metodos.includes("filtro_salvo") && !p.filtro_salvo)
      ctx.addIssue({
        code: "custom",
        path: ["filtro_salvo"],
        message: "informe o filtro salvo",
      });
  });
export type PerfilDoInvestidor = z.infer<typeof PerfilDoInvestidor>;
