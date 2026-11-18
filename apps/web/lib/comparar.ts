import "server-only";
import {
  base100,
  estatisticas,
  inicioDaComparacao,
  LINHAS_DO_COMPARADOR,
  melhoresDaLinha,
  nivelDeTaxa,
  tipoDoIdentificador,
  type Estatisticas,
  type PeriodoDeComparacao,
  type PontoDeNivel,
} from "@bolsiq/analytics";
import type { AssetDetail, Candle, FundDetail } from "@bolsiq/contracts";
import type { Envelope } from "./api";
import { indicadoresCompletos } from "./analytics";
import { hojeEmSp } from "./indicadores-tecnicos";
import { buscarV1, VALIDADE } from "./market-data";

export interface SerieComparada {
  id: string;
  tipo: "ativo" | "fundo" | "indice";
  rotulo: string;
  nome: string;
  classe: string;
  pontos: PontoDeNivel[];
  estatisticas: Estatisticas;
  /** Fonte e atraso, para o rodape. */
  fonte: string | null;
  erro: string | null;
}

export interface Comparacao {
  periodo: PeriodoDeComparacao;
  de: string;
  itens: SerieComparada[];
  benchmarks: SerieComparada[];
  tabela: {
    indicador: string;
    rotulo: string;
    formato: "razao" | "percentual" | "moeda";
    valores: (number | null)[];
    melhores: number[];
  }[];
}

const CLASSE: Record<string, string> = {
  stock: "Ação",
  fii: "FII",
  bdr: "BDR",
  etf: "ETF",
  fund: "Fundo",
};

async function ou<T>(caminho: string, validade: number): Promise<T | null> {
  try {
    const r = await buscarV1<T>(caminho, validade);
    return r.status === 200 ? r.corpo : null;
  } catch {
    return null;
  }
}

function vazia(id: string, tipo: SerieComparada["tipo"], erro: string): SerieComparada {
  return {
    id,
    tipo,
    rotulo: id,
    nome: id,
    classe: "",
    pontos: [],
    estatisticas: { retorno: null, volatilidade_anual: null, drawdown_maximo: null },
    fonte: null,
    erro,
  };
}

async function serieDeAtivo(t: string, de: string): Promise<SerieComparada> {
  const [ativo, hist] = await Promise.all([
    ou<Envelope<AssetDetail>>(`assets/${t}`, VALIDADE.assets),
    ou<Envelope<{ candles: Candle[] }>>(
      `history/${t}?interval=1d&from=${de}&adjusted=true`,
      VALIDADE.history,
    ),
  ]);
  if (!ativo) return vazia(t, "ativo", "Ativo não encontrado");
  const pontos = (hist?.data.candles ?? []).map((c) => ({
    date: c.date,
    valor: Number(c.close),
  }));
  return {
    id: t,
    tipo: "ativo",
    rotulo: t,
    nome: ativo.data.name,
    classe: CLASSE[ativo.data.kind] ?? ativo.data.kind,
    pontos: base100(pontos),
    estatisticas: estatisticas(pontos),
    fonte: hist?.meta.source ?? null,
    erro: pontos.length < 2 ? "Sem pregões no período" : null,
  };
}

async function serieDeFundo(cnpj: string, de: string): Promise<SerieComparada> {
  const [fundo, hist] = await Promise.all([
    ou<Envelope<FundDetail>>(`funds/${cnpj}`, VALIDADE.assets),
    ou<Envelope<{ points: { date: string; nav: string }[] }>>(
      `funds/${cnpj}/history?from=${de}`,
      VALIDADE.history,
    ),
  ]);
  if (!fundo) return vazia(cnpj, "fundo", "Fundo não encontrado");
  const pontos = (hist?.data.points ?? []).map((p) => ({
    date: p.date,
    valor: Number(p.nav),
  }));
  return {
    id: cnpj,
    tipo: "fundo",
    // Nome de fundo e longo: o chip mostra o inicio, o title mostra tudo.
    rotulo: fundo.data.name.split(" ").slice(0, 3).join(" "),
    nome: fundo.data.name,
    classe: "Fundo",
    pontos: base100(pontos),
    estatisticas: estatisticas(pontos),
    fonte: hist?.meta.source ?? null,
    erro: pontos.length < 2 ? "Sem cotas no período (informe diário da CVM)" : null,
  };
}

async function serieDeIndice(id: string, de: string): Promise<SerieComparada> {
  const serie = id.toLowerCase();
  const macro = await ou<
    Envelope<{ points: { date: string; value: string }[]; frequency: string }>
  >(`macro/${serie}?from=${de}`, VALIDADE.macro);
  const brutos = macro?.data.points ?? [];
  // CDI e IPCA sao taxas: o nivel e o acumulado. IBOV ja e nivel.
  const niveis =
    id === "IBOV"
      ? brutos.map((p) => ({ date: p.date, valor: Number(p.value) }))
      : nivelDeTaxa(brutos);
  const diaria = macro?.data.frequency !== "monthly";
  return {
    id,
    tipo: "indice",
    rotulo: id,
    nome: { IBOV: "Ibovespa", CDI: "CDI", IPCA: "IPCA" }[id] ?? id,
    classe: "Índice",
    pontos: base100(niveis),
    estatisticas: estatisticas(niveis, diaria),
    fonte: macro?.meta.source ?? null,
    erro: niveis.length < 2 ? "Série indisponível" : null,
  };
}

function serie(id: string, de: string): Promise<SerieComparada> {
  const tipo = tipoDoIdentificador(id);
  if (tipo === "fundo") return serieDeFundo(id, de);
  if (tipo === "indice") return serieDeIndice(id, de);
  return serieDeAtivo(id, de);
}

/**
 * Monta a comparacao: series base 100, estatisticas e tabela de indicadores
 * com o melhor de cada linha. A regra de "melhor" vem do analytics.
 */
export async function montarComparacao(
  ids: string[],
  periodo: PeriodoDeComparacao,
): Promise<Comparacao> {
  const de = inicioDaComparacao(periodo, hojeEmSp());
  const [itens, benchmarks, indicadores] = await Promise.all([
    Promise.all(ids.map((id) => serie(id, de))),
    Promise.all(["CDI", "IPCA", "IBOV"].map((id) => serieDeIndice(id, de))),
    indicadoresCompletos(ids.filter((id) => tipoDoIdentificador(id) === "ativo")),
  ]);

  const tabela = LINHAS_DO_COMPARADOR.map((l) => {
    const valores = ids.map((id) => indicadores.get(id)?.[l.indicador] ?? null);
    return { ...l, valores, melhores: melhoresDaLinha(l.indicador, valores) };
  });

  return { periodo, de, itens, benchmarks, tabela };
}
