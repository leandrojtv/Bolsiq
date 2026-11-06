import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  FiltroDeScreener,
  filtroDoPreset,
  nivelDeTaxa,
  presets,
  type LinhaDoScreener,
  type NomeDePreset,
  type PeriodoDeComparacao,
} from "@bolsiq/analytics/puro";
import { sugerirAporte, type ModoDeRecomendacao } from "./aporte.js";
import { diagnosticar } from "./diagnostico.js";
import { limitarSaida } from "./orcamento.js";
import type { PerfilDoInvestidor } from "./perfil.js";
import type {
  CarteiraResumida,
  Comprovado,
  IndicadoresDoAtivo,
  Proveniencia,
} from "./tipos.js";

const Ticker = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,12}$/)
  .describe("Ticker da B3, como PETR4");
const IdDaCarteira = z
  .string()
  .uuid()
  .optional()
  .describe("Id da carteira. Omita para a carteira da tela ou a primeira do usuário");

const PERIODOS = ["1M", "3M", "6M", "1A", "2A", "5A"] as const;
const MAX_PONTOS = 60;
const MAX_LINHAS_DO_SCREENER = 20;
const MAX_POSICOES_NA_CORRELACAO = 10;

export interface Cotacao {
  ticker: string;
  price: string;
  change_percent: string;
  quoted_at: string;
  stale: boolean;
}

export interface Candle {
  date: string;
  close: string;
  financial_volume?: string;
}

export interface Provento {
  ticker: string;
  kind: string;
  ex_date: string;
  payment_date: string | null;
  value_per_share: string | null;
}

export interface PeriodoDeFundamentos {
  reference_date: string;
  statement_kind: string;
  revenue: string | null;
  ebit: string | null;
  net_income: string | null;
  equity: string | null;
  gross_debt: string | null;
  cash_and_equivalents: string | null;
}

export interface ComparacaoResumida {
  periodo: string;
  de: string;
  itens: {
    id: string;
    nome: string;
    classe: string;
    estatisticas: {
      retorno: number | null;
      volatilidade_anual: number | null;
      drawdown_maximo: number | null;
    };
    fonte: string | null;
    erro: string | null;
  }[];
  benchmarks: ComparacaoResumida["itens"];
  tabela: { indicador: string; rotulo: string; valores: (number | null)[] }[];
}

/**
 * De onde as ferramentas leem. O BFF implementa com o /v1, o analytics e o
 * `painel` da carteira, ja dentro da sessao do usuario (RLS); o eval, com a base
 * de teste. Nenhuma ferramenta recebe id de usuario do modelo.
 */
export interface Fontes {
  cotacoes(tickers: string[]): Promise<Comprovado<Cotacao[]>>;
  historico(ticker: string, de: string): Promise<Comprovado<Candle[]>>;
  proventos(ticker: string, de: string): Promise<Comprovado<Provento[]>>;
  fundamentos(
    ticker: string,
    periodo: "annual" | "quarterly",
  ): Promise<Comprovado<PeriodoDeFundamentos[]>>;
  indicadores(tickers: string[]): Promise<Map<string, IndicadoresDoAtivo>>;
  comparar(
    ids: string[],
    periodo: PeriodoDeComparacao,
  ): Promise<Comprovado<ComparacaoResumida>>;
  screener(
    filtro: FiltroDeScreener,
  ): Promise<{ total: number; linhas: LinhaDoScreener[] }>;
  macro(
    serie: "selic" | "ipca" | "cdi" | "ibov",
    de: string,
  ): Promise<Comprovado<{ date: string; value: string }[]>>;
  /** Carteira do usuario logado; nula se nao for dele ou nao existir. */
  carteira(id?: string): Promise<Comprovado<CarteiraResumida> | null>;
  perfil(): Promise<PerfilDoInvestidor | null>;
}

const FONTE_ANALYTICS = "Bolsiq analytics (CVM DFP e B3 COTAHIST)";
const provIndicadores = (data: string): Proveniencia => ({
  fonte: FONTE_ANALYTICS,
  data,
  atrasado: false,
});

/** Falha de fonte vira dado que o modelo le ("nao tenho"), nunca excecao crua. */
async function seguro<T>(fn: () => Promise<T>) {
  try {
    return limitarSaida(await fn());
  } catch {
    return { erro: "indisponivel", mensagem: "A fonte não respondeu agora." };
  }
}

const SEM_CARTEIRA = {
  erro: "carteira_nao_encontrada",
  mensagem: "Carteira não encontrada para este usuário.",
};
const SEM_PERFIL = {
  erro: "perfil_ausente",
  mensagem: "Preencha o perfil do investidor em /configuracoes/perfil.",
  link: "/configuracoes/perfil",
};

function anosAtras(hoje: string, meses: number): string {
  const d = new Date(`${hoje}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - meses);
  return d.toISOString().slice(0, 10);
}
const MESES: Record<(typeof PERIODOS)[number], number> = {
  "1M": 1,
  "3M": 3,
  "6M": 6,
  "1A": 12,
  "2A": 24,
  "5A": 60,
};

/** Serie longa nao vai inteira ao modelo: pontos espacados, sempre com o ultimo. */
export function resumirSerie<T>(pontos: T[], max = MAX_PONTOS): T[] {
  if (pontos.length <= max) return pontos;
  const passo = (pontos.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => pontos[Math.round(i * passo)] as T);
}

function resumirLinha(l: LinhaDoScreener) {
  return {
    ticker: l.ticker,
    nome: l.name,
    tipo: l.kind,
    setor: l.sector,
    preco: l.preco,
    data: l.reference_date,
    indicadores: Object.fromEntries(
      Object.entries(l.indicadores).filter(([, v]) => v !== null),
    ),
    link: `/ativo/${l.ticker}`,
  };
}

function ultimo<T>(lista: T[]): T | null {
  return lista.at(-1) ?? null;
}

export interface OpcoesDasFerramentas {
  hoje: string;
  modo: ModoDeRecomendacao;
  /** Carteira da tela: vale quando o modelo nao informa `id`. */
  carteiraDaTela?: string | undefined;
}

export const NOMES_DAS_FERRAMENTAS = [
  "cotacao",
  "historico",
  "proventos",
  "fundamentos",
  "indicadores",
  "comparar",
  "screener",
  "cenario_macro",
  "minha_carteira",
  "avaliar_carteira",
  "sugerir_aporte",
  "criar_alerta",
] as const;
export type NomeDaFerramenta = (typeof NOMES_DAS_FERRAMENTAS)[number];

export function criarFerramentas(
  fontes: Fontes,
  { hoje, modo, carteiraDaTela }: OpcoesDasFerramentas,
): ToolSet {
  const carteiraDe = (id?: string) => fontes.carteira(id ?? carteiraDaTela);

  return {
    cotacao: tool({
      description: "Cotação atual de até 20 ativos, com variação do dia, fonte e atraso.",
      inputSchema: z.object({ tickers: z.array(Ticker).min(1).max(20) }),
      execute: ({ tickers }) =>
        seguro(async () => {
          const r = await fontes.cotacoes(tickers);
          return {
            cotacoes: r.dados.map((q) => ({ ...q, link: `/ativo/${q.ticker}` })),
            proveniencia: r.proveniencia,
          };
        }),
    }),

    historico: tool({
      description:
        "Fechamentos ajustados de um ativo no período: resumo e pontos espaçados, não a série inteira.",
      inputSchema: z.object({ ticker: Ticker, periodo: z.enum(PERIODOS).default("1A") }),
      execute: ({ ticker, periodo }) =>
        seguro(async () => {
          const r = await fontes.historico(ticker, anosAtras(hoje, MESES[periodo]));
          const fechamentos = r.dados.map((c) => Number(c.close));
          const primeiro = fechamentos[0];
          const final = fechamentos.at(-1);
          return {
            ticker,
            periodo,
            pregoes: r.dados.length,
            primeiro: r.dados[0] ?? null,
            ultimo: ultimo(r.dados),
            retorno: primeiro && final ? Number((final / primeiro - 1).toFixed(6)) : null,
            minimo: r.dados.length ? Math.min(...fechamentos) : null,
            maximo: r.dados.length ? Math.max(...fechamentos) : null,
            pontos: resumirSerie(
              r.dados.map((c) => ({ data: c.date, fechamento: c.close })),
            ),
            link: `/ativo/${ticker}`,
            proveniencia: r.proveniencia,
          };
        }),
    }),

    proventos: tool({
      description:
        "Proventos de um ativo nos últimos anos, com data-ex e valor por ação.",
      inputSchema: z.object({
        ticker: Ticker,
        anos: z.number().int().min(1).max(10).default(2),
      }),
      execute: ({ ticker, anos }) =>
        seguro(async () => {
          const r = await fontes.proventos(ticker, anosAtras(hoje, anos * 12));
          return {
            ticker,
            proventos: r.dados.slice(-40),
            link: `/ativo/${ticker}`,
            proveniencia: r.proveniencia,
          };
        }),
    }),

    fundamentos: tool({
      description:
        "Contas dos demonstrativos da CVM: receita, EBIT, lucro, patrimônio, dívida e caixa.",
      inputSchema: z.object({
        ticker: Ticker,
        periodo: z.enum(["annual", "quarterly"]).default("annual"),
      }),
      execute: ({ ticker, periodo }) =>
        seguro(async () => {
          const r = await fontes.fundamentos(ticker, periodo);
          return {
            ticker,
            periodos: r.dados.slice(-6),
            link: `/ativo/${ticker}`,
            proveniencia: r.proveniencia,
          };
        }),
    }),

    indicadores: tool({
      description:
        "Indicadores calculados de até 10 ativos: P/L, P/VP, DY, ROE, margens, endividamento, volatilidade, beta e preço justo de Graham e Bazin.",
      inputSchema: z.object({ tickers: z.array(Ticker).min(1).max(10) }),
      execute: ({ tickers }) =>
        seguro(async () => {
          const mapa = await fontes.indicadores(tickers);
          return {
            ativos: tickers.map((t) => {
              const i = mapa.get(t);
              return i
                ? { ticker: t, ...i, link: `/ativo/${t}` }
                : { ticker: t, erro: "sem_indicadores" };
            }),
            proveniencia: [...mapa.values()].map((i) =>
              provIndicadores(i.reference_date),
            ),
          };
        }),
    }),

    comparar: tool({
      description:
        "Compara de 2 a 6 ativos no período: retorno, volatilidade, drawdown, benchmarks (CDI, IPCA, IBOV) e indicadores.",
      inputSchema: z.object({
        tickers: z.array(Ticker).min(2).max(6),
        periodo: z.enum(["6M", "1A", "2A", "5A"]).default("1A"),
      }),
      execute: ({ tickers, periodo }) =>
        seguro(async () => {
          const r = await fontes.comparar(tickers, periodo);
          return {
            ...r.dados,
            link: `/comparar?t=${tickers.join(",")}&p=${periodo}`,
            proveniencia: r.proveniencia,
          };
        }),
    }),

    screener: tool({
      description:
        "Filtra ativos por preset (graham, bazin, magic_formula, dividendos_consistentes) ou por faixas de indicadores. Filtro, não recomendação.",
      inputSchema: z.object({
        preset: z
          .enum(Object.keys(presets) as [NomeDePreset, ...NomeDePreset[]])
          .optional(),
        faixas: z
          .record(
            z.string(),
            z.object({ min: z.number().optional(), max: z.number().optional() }),
          )
          .optional(),
        tipos: z.array(z.enum(["stock", "fii", "bdr", "etf", "fund"])).optional(),
        liquidez_minima: z.number().nonnegative().optional(),
        limite: z.number().int().min(1).max(MAX_LINHAS_DO_SCREENER).default(10),
      }),
      execute: ({ preset, faixas, tipos, liquidez_minima, limite }) =>
        seguro(async () => {
          const base = preset ? filtroDoPreset(preset) : {};
          const validado = FiltroDeScreener.safeParse({
            ...base,
            ...(faixas ? { faixas } : {}),
            ...(tipos ? { tipos } : {}),
            ...(liquidez_minima !== undefined ? { liquidez_minima } : {}),
            limite,
          });
          if (!validado.success)
            return {
              erro: "filtro_invalido",
              mensagem: validado.error.issues[0]?.message,
            };
          const r = await fontes.screener(validado.data);
          const data = r.linhas
            .map((l) => l.reference_date)
            .sort()
            .at(-1);
          return {
            preset: preset ?? null,
            total: r.total,
            linhas: r.linhas.map(resumirLinha),
            link: preset ? `/screener?preset=${preset}` : "/screener",
            proveniencia: data ? [provIndicadores(data)] : [],
          };
        }),
    }),

    cenario_macro: tool({
      description:
        "Cenário recente: Selic, IPCA (mês e 12 meses), CDI (dia e 12 meses) e IBOV (último e 12 meses), do BCB e do market-data.",
      inputSchema: z.object({}),
      execute: () =>
        seguro(async () => {
          const de = anosAtras(hoje, 12);
          const [selic, ipca, cdi, ibov] = await Promise.all(
            (["selic", "ipca", "cdi", "ibov"] as const).map((s) => fontes.macro(s, de)),
          );
          const acumulado = (p: { date: string; value: string }[]) => {
            const n = ultimo(nivelDeTaxa(p));
            return n ? Number((n.valor - 1).toFixed(6)) : null;
          };
          const ibovP = ibov?.dados ?? [];
          const ibov0 = Number(ibovP[0]?.value);
          const ibovF = ultimo(ibovP);
          return {
            selic: ultimo(selic?.dados ?? []),
            ipca_mes: ultimo(ipca?.dados ?? []),
            ipca_12m: acumulado(ipca?.dados ?? []),
            cdi_dia: ultimo(cdi?.dados ?? []),
            cdi_12m: acumulado(cdi?.dados ?? []),
            ibov: ibovF,
            ibov_12m:
              ibovF && ibov0
                ? Number((Number(ibovF.value) / ibov0 - 1).toFixed(6))
                : null,
            proveniencia: [selic, ipca, cdi, ibov].flatMap((x) => x?.proveniencia ?? []),
          };
        }),
    }),

    minha_carteira: tool({
      description:
        "Carteira do usuário logado: posições, preço médio, TWR contra CDI e IBOV, alocação e proventos. Mesmos números da tela.",
      inputSchema: z.object({ id: IdDaCarteira }),
      execute: ({ id }) =>
        seguro(async () => {
          const r = await carteiraDe(id);
          if (!r) return SEM_CARTEIRA;
          // A serie e do grafico; fica fora para nao gastar token.
          const { serie: _serie, ...c } = r.dados;
          return { ...c, link: `/carteiras/${c.id}`, proveniencia: r.proveniencia };
        }),
    }),

    avaliar_carteira: tool({
      description:
        "Diagnóstico da carteira calculado pelo Bolsiq: concentração por ativo e setor contra os limites do perfil, desvio da alocação-alvo, volatilidade, drawdown, beta, correlação, DY médio e margens de Graham e Bazin.",
      inputSchema: z.object({ id: IdDaCarteira }),
      execute: ({ id }) =>
        seguro(async () => {
          const perfil = await fontes.perfil();
          if (!perfil) return SEM_PERFIL;
          const r = await carteiraDe(id);
          if (!r) return SEM_CARTEIRA;
          const tickers = r.dados.posicoes.map((p) => p.ticker);
          const de = anosAtras(hoje, 12);
          const [indicadores, series] = await Promise.all([
            fontes.indicadores(tickers),
            Promise.all(
              tickers.slice(0, MAX_POSICOES_NA_CORRELACAO).map(async (t) => {
                const h = await fontes.historico(t, de).catch(() => null);
                return [
                  t,
                  (h?.dados ?? []).map((c) => ({ date: c.date, close: Number(c.close) })),
                ] as const;
              }),
            ),
          ]);
          const datas = [...indicadores.values()].map((i) => i.reference_date).sort();
          return {
            ...diagnosticar({
              carteira: r.dados,
              perfil,
              indicadores,
              historicos: new Map(series.filter(([, s]) => s.length > 0)),
            }),
            proveniencia: [
              ...r.proveniencia,
              ...(datas.at(-1) ? [provIndicadores(datas.at(-1) as string)] : []),
            ],
          };
        }),
    }),

    sugerir_aporte: tool({
      description:
        "Candidatos de aporte gerados pelo Bolsiq: quanto por classe para aproximar da alocação-alvo e, em cada classe, ativos que passam nos critérios do perfil, com score, critérios atendidos e riscos. É a única fonte de sugestão de compra.",
      inputSchema: z.object({
        valor: z
          .number()
          .positive()
          .max(1_000_000_000)
          .describe("Valor do aporte, em reais"),
        id: IdDaCarteira,
      }),
      execute: ({ valor, id }) =>
        seguro(async () => {
          const perfil = await fontes.perfil();
          if (!perfil) return SEM_PERFIL;
          const r = await carteiraDe(id);
          if (!r) return SEM_CARTEIRA;
          const s = await sugerirAporte({
            valor: valor.toFixed(2),
            carteira: r.dados,
            perfil,
            modo,
            screener: (f) => fontes.screener(f),
          });
          return {
            ...s,
            link: `/carteiras/${r.dados.id}`,
            proveniencia: [
              ...r.proveniencia,
              ...s.datas_dos_indicadores.slice(-1).map(provIndicadores),
            ],
          };
        }),
    }),

    criar_alerta: tool({
      description:
        "Propõe um alerta de preço ou fundamento. NÃO grava: a tela mostra a proposta e o usuário confirma.",
      inputSchema: z.object({
        ticker: Ticker,
        tipo: z.enum([
          "preco_acima",
          "preco_abaixo",
          "variacao_diaria",
          "abaixo_graham",
          "abaixo_bazin",
          "dy_acima",
          "provento_anunciado",
          "data_com_proxima",
          "demonstrativo_publicado",
        ]),
        valor: z
          .number()
          .optional()
          .describe("Preço em reais, ou percentual em variacao_diaria e dy_acima"),
      }),
      // Sem escrita aqui de proposito: o botao da tela e que chama /api/alertas/regras.
      execute: (proposta) =>
        Promise.resolve({
          pendente_de_confirmacao: true,
          proposta,
          mensagem: "O alerta só será criado se o usuário confirmar na tela.",
        }),
    }),
  } satisfies ToolSet & Record<NomeDaFerramenta, unknown>;
}

export type { CarteiraResumida };
