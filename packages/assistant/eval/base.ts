import {
  alocar,
  apurar,
  avaliar,
  proventosPorMes,
  Transacao,
  type PosicaoAvaliada,
} from "@bolsiq/portfolio";
import type { FiltroDeScreener, LinhaDoScreener } from "@bolsiq/analytics/puro";
import type { Fontes } from "../src/ferramentas.js";
import type { PerfilDoInvestidor } from "../src/perfil.js";
import type { CarteiraResumida, IndicadoresDoAtivo, Proveniencia } from "../src/tipos.js";

/**
 * Base de teste do eval: a carteira de conferencia de docs/services/portfolio.md
 * e um universo pequeno com numeros fixos. E o "banco" contra o qual as respostas
 * do modelo sao conferidas.
 */
export const HOJE = "2026-10-30";
export const CARTEIRA_ID = "5f7c1f0e-6b2a-4c11-9a50-3d2e8f6a1b00";

const CONFERENCIA = [
  ["2024-01-15", "PETR4", "compra", "100", "35.00", "5.00"],
  ["2024-02-10", "PETR4", "compra", "50", "38.00", "3.00"],
  ["2024-03-05", "PETR4", "provento", "150", "0.80", "0"],
  ["2024-04-20", "VALE3", "compra", "80", "62.00", "4.00"],
  ["2024-05-15", "PETR4", "venda", "60", "42.00", "6.00"],
  ["2024-06-10", "PETR4", "desdobramento", "2", "0", "0"],
  ["2024-07-01", "VALE3", "provento", "80", "1.50", "0"],
  ["2024-08-12", "VALE3", "compra", "20", "58.00", "2.00"],
  ["2024-09-20", "VALE3", "venda", "50", "65.00", "5.00"],
  ["2024-10-05", "PETR4", "provento", "180", "0.45", "0"],
] as const;

export const PRECOS: Record<string, string> = {
  PETR4: "38.42",
  VALE3: "61.00",
  PRIO3: "44.10",
  WEGE3: "52.30",
  BBAS3: "27.15",
  TAEE11: "36.80",
  HGLG11: "158.20",
  KNRI11: "141.75",
  BOVA11: "128.40",
};

const SETOR: Record<string, string> = {
  PETR4: "Petróleo e gás",
  VALE3: "Mineração",
  PRIO3: "Petróleo e gás",
  WEGE3: "Bens industriais",
  BBAS3: "Financeiro",
  TAEE11: "Energia elétrica",
  HGLG11: "Logística",
  KNRI11: "Híbrido",
  BOVA11: "Índice",
};

type Ind = LinhaDoScreener["indicadores"];
const linha = (
  ticker: string,
  name: string,
  kind: string,
  indicadores: Ind,
): LinhaDoScreener => ({
  ticker,
  name,
  kind,
  sector: SETOR[ticker] ?? null,
  reference_date: "2026-10-29",
  preco: PRECOS[ticker] ?? null,
  indicadores,
});

export const UNIVERSO: LinhaDoScreener[] = [
  linha("PETR4", "Petrobras", "stock", {
    pl: 4.21,
    pvp: 1.02,
    dy_12m: 0.1312,
    dy_medio_5a: 0.1508,
    roe: 0.2431,
    roic: 0.1812,
    margem_liquida: 0.1754,
    dl_ebitda: 1.73,
    ev_ebit: 3.9,
    margem_graham: 0.2912,
    margem_bazin: 0.3405,
    volatilidade_anual: 0.312,
    drawdown_maximo: -0.223,
    beta: 1.12,
    liquidez_diaria: 1_850_000_000,
    cagr_lucro_5a: 0.082,
  }),
  linha("VALE3", "Vale", "stock", {
    pl: 6.05,
    pvp: 1.41,
    dy_12m: 0.0921,
    dy_medio_5a: 0.1103,
    roe: 0.1424,
    roic: 0.1311,
    margem_liquida: 0.1477,
    dl_ebitda: 0.91,
    ev_ebit: 5.2,
    margem_graham: 0.1205,
    margem_bazin: 0.2201,
    volatilidade_anual: 0.284,
    drawdown_maximo: -0.254,
    beta: 0.94,
    liquidez_diaria: 1_420_000_000,
    cagr_lucro_5a: -0.041,
  }),
  linha("PRIO3", "Prio", "stock", {
    pl: 7.8,
    pvp: 1.35,
    dy_12m: 0.0,
    roe: 0.291,
    roic: 0.224,
    margem_liquida: 0.312,
    dl_ebitda: 1.21,
    ev_ebit: 6.4,
    margem_graham: 0.221,
    volatilidade_anual: 0.441,
    drawdown_maximo: -0.351,
    beta: 1.31,
    liquidez_diaria: 520_000_000,
    cagr_lucro_5a: 0.214,
  }),
  linha("WEGE3", "WEG", "stock", {
    pl: 28.4,
    pvp: 8.6,
    dy_12m: 0.0151,
    roe: 0.2732,
    roic: 0.251,
    margem_liquida: 0.1663,
    dl_ebitda: -0.44,
    ev_ebit: 22.1,
    volatilidade_anual: 0.261,
    drawdown_maximo: -0.201,
    beta: 0.78,
    liquidez_diaria: 410_000_000,
    cagr_lucro_5a: 0.191,
  }),
  linha("BBAS3", "Banco do Brasil", "stock", {
    pl: 4.05,
    pvp: 0.74,
    dy_12m: 0.0982,
    dy_medio_5a: 0.0841,
    roe: 0.183,
    margem_graham: 0.412,
    margem_bazin: 0.102,
    volatilidade_anual: 0.275,
    drawdown_maximo: -0.312,
    beta: 0.88,
    liquidez_diaria: 690_000_000,
    cagr_lucro_5a: -0.022,
  }),
  linha("TAEE11", "Taesa", "stock", {
    pl: 9.1,
    pvp: 1.45,
    dy_12m: 0.0981,
    dy_medio_5a: 0.1021,
    roe: 0.161,
    roic: 0.112,
    dl_ebitda: 3.42,
    ev_ebit: 8.1,
    margem_graham: 0.205,
    margem_bazin: 0.183,
    volatilidade_anual: 0.181,
    drawdown_maximo: -0.131,
    beta: 0.41,
    liquidez_diaria: 95_000_000,
    cagr_lucro_5a: 0.012,
  }),
  linha("HGLG11", "CSHG Logística", "fii", {
    dy_12m: 0.0862,
    dy_medio_5a: 0.0781,
    margem_bazin: 0.091,
    volatilidade_anual: 0.141,
    drawdown_maximo: -0.112,
    liquidez_diaria: 28_000_000,
  }),
  linha("KNRI11", "Kinea Renda", "fii", {
    dy_12m: 0.0791,
    dy_medio_5a: 0.0702,
    margem_bazin: 0.051,
    volatilidade_anual: 0.123,
    drawdown_maximo: -0.098,
    liquidez_diaria: 300_000,
  }),
  linha("BOVA11", "iShares Ibovespa", "etf", {
    volatilidade_anual: 0.191,
    drawdown_maximo: -0.165,
    liquidez_diaria: 900_000_000,
  }),
];

export const PERFIL: PerfilDoInvestidor = {
  objetivo: "crescimento",
  horizonte: "longo",
  tolerancia: "media",
  alocacao_alvo: { acoes: 0.6, fiis: 0.25, etfs: 0.1, renda_fixa: 0.05 },
  limite_ativo: 0.2,
  limite_setor: 0.4,
  metodos: ["graham", "bazin"],
  filtro_salvo: null,
  evitar: [],
  liquidez_minima: 1_000_000,
};

const prov = (fonte: string, data: string, atrasado = false): Proveniencia => ({
  fonte,
  data,
  atrasado,
});

/** A carteira como a tela: mesmas funcoes do `painel`, sobre a conferencia. */
export function carteiraDeConferencia(): CarteiraResumida {
  const txs = CONFERENCIA.map(([data, ticker, tipo, quantidade, preco, taxas], i) =>
    Transacao.parse({ id: String(i), ticker, tipo, data, quantidade, preco, taxas }),
  );
  const apuracao = apurar(txs);
  const abertas = apuracao.posicoes.filter((p) => Number(p.quantidade) > 0);
  const avaliadas = avaliar(abertas, PRECOS);
  const custo = avaliadas.reduce((s, p) => s + Number(p.custo_total), 0);
  const patrimonio = avaliadas.reduce((s, p) => s + Number(p.valor_de_mercado), 0);
  const serie = Array.from({ length: 21 }, (_, i) => ({
    data: `2026-10-${String(i + 8).padStart(2, "0")}`,
    carteira: 100 * (1 + 0.004 * i + (i % 3 === 0 ? -0.006 : 0.003)),
    ibov: 100 * (1 + 0.002 * i + (i % 3 === 0 ? -0.004 : 0.002)),
  }));
  return {
    id: CARTEIRA_ID,
    nome: "Principal",
    patrimonio: patrimonio.toFixed(2),
    custo: custo.toFixed(2),
    nao_realizado: (patrimonio - custo).toFixed(2),
    nao_realizado_pct: Number((patrimonio / custo - 1).toFixed(6)),
    realizado: apuracao.resultado_realizado_total,
    proventos_12m: proventosPorMes(txs)
      .filter((p) => p.mes >= "2025-10")
      .reduce((s, p) => s + Number(p.valor), 0)
      .toFixed(2),
    twr_12m: 0.1842,
    cdi_12m: 0.1215,
    ibov_12m: 0.0934,
    sem_cotacao: [],
    posicoes: avaliadas.map((p: PosicaoAvaliada) => ({
      ...p,
      classe: "Ações",
      setor: SETOR[p.ticker] ?? "Sem setor",
    })),
    alocacao: {
      classe: alocar(avaliadas, () => "Ações"),
      setor: alocar(avaliadas, (p) => SETOR[p.ticker] ?? "Sem setor"),
      ativo: alocar(avaliadas, (p) => p.ticker),
    },
    serie,
    recalculando: false,
  };
}

const serieDe = (ticker: string) => {
  const base = Number(PRECOS[ticker] ?? 10);
  return Array.from({ length: 21 }, (_, i) => ({
    date: `2026-10-${String(i + 8).padStart(2, "0")}`,
    close: (
      base *
      (0.95 + 0.0025 * i + (ticker.charCodeAt(0) % 5) * 0.001 * (i % 2))
    ).toFixed(2),
  }));
};

const MACRO: Record<string, { date: string; value: string }[]> = {
  selic: [{ date: "2026-10-29", value: "11.25" }],
  ipca: [
    { date: "2026-08-31", value: "0.30" },
    { date: "2026-09-30", value: "0.44" },
  ],
  cdi: [
    { date: "2026-10-28", value: "0.0416" },
    { date: "2026-10-29", value: "0.0416" },
  ],
  ibov: [
    { date: "2025-10-30", value: "130000.00" },
    { date: "2026-10-29", value: "142140.00" },
  ],
};

function casaFiltro(l: LinhaDoScreener, f: FiltroDeScreener): boolean {
  if (f.tipos?.length && !f.tipos.includes(l.kind as "stock")) return false;
  if (
    f.liquidez_minima !== undefined &&
    (l.indicadores.liquidez_diaria ?? 0) < f.liquidez_minima
  )
    return false;
  return Object.entries(f.faixas).every(([n, faixa]) => {
    const v = l.indicadores[n as keyof Ind];
    if (v === null || v === undefined) return false;
    return (
      (faixa.min === undefined || v >= faixa.min) &&
      (faixa.max === undefined || v <= faixa.max)
    );
  });
}

/** Mesma interface do BFF, em memoria. */
export function fontesDeTeste(opcoes: { semPerfil?: boolean } = {}): Fontes {
  const carteira = carteiraDeConferencia();
  return {
    cotacoes: (tickers) => {
      const dados = tickers
        .filter((t) => PRECOS[t])
        .map((t) => ({
          ticker: t,
          price: PRECOS[t] as string,
          change_percent: t === "PETR4" ? "1.25" : "-0.40",
          quoted_at: `${HOJE}T17:00:00Z`,
          stale: false,
        }));
      if (dados.length === 0) return Promise.reject(new Error("sem cotacao"));
      return Promise.resolve({
        dados,
        proveniencia: [
          {
            fonte: "brapi",
            data: `${HOJE}T17:00:00Z`,
            atrasado: false,
            atraso_minutos: 15,
          },
        ],
      });
    },
    historico: (ticker) =>
      PRECOS[ticker]
        ? Promise.resolve({
            dados: serieDe(ticker),
            proveniencia: [prov("B3 COTAHIST", "2026-10-28")],
          })
        : Promise.reject(new Error("sem historico")),
    proventos: (ticker) =>
      Promise.resolve({
        dados:
          ticker === "VALE3"
            ? [
                {
                  ticker,
                  kind: "dividendo",
                  ex_date: "2026-03-10",
                  payment_date: "2026-03-20",
                  value_per_share: "2.14",
                },
              ]
            : [],
        proveniencia: [prov("brapi", "2026-10-29")],
      }),
    fundamentos: (ticker) =>
      ticker === "PETR4"
        ? Promise.resolve({
            dados: [
              {
                reference_date: "2024-12-31",
                statement_kind: "DFP",
                revenue: "490800000000",
                ebit: "150000000000",
                net_income: "37000000000",
                equity: "367000000000",
                gross_debt: "420000000000",
                cash_and_equivalents: "66800000000",
              },
            ],
            proveniencia: [prov("CVM DFP", "2024-12-31")],
          })
        : Promise.reject(new Error("sem fundamentos")),
    indicadores: (tickers) =>
      Promise.resolve(
        new Map<string, IndicadoresDoAtivo>(
          UNIVERSO.filter((l) => tickers.includes(l.ticker)).map((l) => [
            l.ticker,
            { ...l.indicadores, reference_date: l.reference_date },
          ]),
        ),
      ),
    comparar: (ids, periodo) =>
      Promise.resolve({
        dados: {
          periodo,
          de: "2025-10-30",
          itens: ids.map((id, i) => ({
            id,
            nome: id,
            classe: "Ação",
            estatisticas: {
              retorno: id === "PETR4" ? 0.2214 : id === "PRIO3" ? 0.3102 : 0.05 + i / 100,
              volatilidade_anual: id === "PETR4" ? 0.312 : 0.441,
              drawdown_maximo: id === "PETR4" ? -0.223 : -0.351,
            },
            fonte: "B3 COTAHIST",
            erro: null,
          })),
          benchmarks: [],
          tabela: [],
        },
        proveniencia: [prov("B3 COTAHIST", "2026-10-28")],
      }),
    screener: (filtro) => {
      const linhas = UNIVERSO.filter((l) => casaFiltro(l, filtro)).slice(
        0,
        filtro.limite,
      );
      return Promise.resolve({ total: linhas.length, linhas });
    },
    macro: (serie) =>
      Promise.resolve({
        dados: MACRO[serie] ?? [],
        proveniencia: [prov("BCB SGS", MACRO[serie]?.at(-1)?.date ?? HOJE)],
      }),
    carteira: (id) =>
      Promise.resolve(
        id && id !== CARTEIRA_ID
          ? null
          : { dados: carteira, proveniencia: [prov("brapi e B3 COTAHIST", HOJE)] },
      ),
    perfil: () => Promise.resolve(opcoes.semPerfil ? null : PERFIL),
  };
}
