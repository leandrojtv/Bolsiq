import { beta, drawdownMaximo, volatilidadeAnual } from "@bolsiq/analytics/puro";
import { CLASSES, NOMES_DE_CLASSE, type PerfilDoInvestidor } from "./perfil.js";
import type { CarteiraResumida, FatiaResumida, IndicadoresDoAtivo } from "./tipos.js";

/** Retornos simples de uma serie de niveis. */
export function retornos(niveis: number[]): number[] {
  const saida: number[] = [];
  for (let i = 1; i < niveis.length; i++) {
    const a = niveis[i - 1] ?? 0;
    if (a > 0) saida.push((niveis[i] ?? 0) / a - 1);
  }
  return saida;
}

/** Correlacao de Pearson. Nula com menos de 3 pontos ou serie constante. */
export function correlacao(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 3) return null;
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    const da = (a[i] ?? 0) - ma;
    const db = (b[i] ?? 0) - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return null;
  return Number((cov / Math.sqrt(va * vb)).toFixed(4));
}

export interface LinhaDeConcentracao {
  chave: string;
  fracao: number;
  limite: number;
  acima: boolean;
}

function concentracao(fatias: FatiaResumida[], limite: number): LinhaDeConcentracao[] {
  return fatias.flatMap((f) =>
    f.fracao === null
      ? []
      : [{ chave: f.chave, fracao: f.fracao, limite, acima: f.fracao > limite }],
  );
}

export interface DesvioDeClasse {
  classe: string;
  atual: number;
  alvo: number;
  desvio: number;
  /** Quanto falta (positivo) ou sobra (negativo) em reais para chegar ao alvo. */
  valor_para_alvo: string | null;
}

/** Desvio da carteira em relacao a alocacao-alvo, por classe do perfil. */
export function desvioDaAlocacao(
  carteira: CarteiraResumida,
  perfil: PerfilDoInvestidor,
): DesvioDeClasse[] {
  const atual = new Map(carteira.alocacao.classe.map((f) => [f.chave, f.fracao ?? 0]));
  const patrimonio = carteira.patrimonio === null ? null : Number(carteira.patrimonio);
  return NOMES_DE_CLASSE.flatMap((c) => {
    const { rotulo } = CLASSES[c];
    const alvo = perfil.alocacao_alvo[c] ?? 0;
    const a = atual.get(rotulo) ?? 0;
    if (alvo === 0 && a === 0) return [];
    return [
      {
        classe: rotulo,
        atual: a,
        alvo,
        desvio: Number((a - alvo).toFixed(6)),
        valor_para_alvo:
          patrimonio === null ? null : ((alvo - a) * patrimonio).toFixed(2),
      },
    ];
  });
}

/** Retornos da carteira e do IBOV nos mesmos dias, a partir dos snapshots. */
function retornosDaSerie(serie: CarteiraResumida["serie"]) {
  const carteira = retornos(serie.map((s) => s.carteira));
  const pares = serie.filter((s) => s.ibov !== null);
  const alinhadosC = retornos(pares.map((s) => s.carteira));
  const alinhadosI = retornos(pares.map((s) => s.ibov ?? 0));
  return { carteira, alinhadosC, alinhadosI };
}

const MAX_CORRELACOES = 10;

export interface EntradaDoDiagnostico {
  carteira: CarteiraResumida;
  perfil: PerfilDoInvestidor;
  indicadores: Map<string, IndicadoresDoAtivo>;
  /** Fechamentos por ticker e data. Sem serie, o ativo fica fora da correlacao. */
  historicos: Map<string, { date: string; close: number }[]>;
}

/** Correlacao dos retornos diarios entre posicoes, nas datas em comum. */
export function correlacoes(historicos: EntradaDoDiagnostico["historicos"]) {
  const tickers = [...historicos.keys()];
  const pares: { a: string; b: string; correlacao: number; pregoes: number }[] = [];
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const a = tickers[i] as string;
      const b = tickers[j] as string;
      const pb = new Map((historicos.get(b) ?? []).map((p) => [p.date, p.close]));
      const comuns = (historicos.get(a) ?? []).filter((p) => pb.has(p.date));
      const c = correlacao(
        retornos(comuns.map((p) => p.close)),
        retornos(comuns.map((p) => pb.get(p.date) ?? 0)),
      );
      if (c !== null) pares.push({ a, b, correlacao: c, pregoes: comuns.length });
    }
  }
  return pares
    .sort((x, y) => Math.abs(y.correlacao) - Math.abs(x.correlacao))
    .slice(0, MAX_CORRELACOES);
}

/**
 * Diagnostico calculado aqui, nao pelo modelo: o modelo so explica estes
 * numeros, e os dois caminhos (tela e assistente) partem da mesma carteira.
 */
export function diagnosticar({
  carteira,
  perfil,
  indicadores,
  historicos,
}: EntradaDoDiagnostico) {
  const ativos = concentracao(carteira.alocacao.ativo, perfil.limite_ativo);
  const setores = concentracao(carteira.alocacao.setor, perfil.limite_setor);
  const { carteira: r, alinhadosC, alinhadosI } = retornosDaSerie(carteira.serie);

  const fracaoDe = new Map(carteira.alocacao.ativo.map((f) => [f.chave, f.fracao ?? 0]));
  const comDy = carteira.posicoes.filter(
    (p) => typeof indicadores.get(p.ticker)?.dy_12m === "number",
  );
  const pesoDy = comDy.reduce((s, p) => s + (fracaoDe.get(p.ticker) ?? 0), 0);
  const dyMedio =
    pesoDy > 0
      ? comDy.reduce(
          (s, p) =>
            s + (fracaoDe.get(p.ticker) ?? 0) * (indicadores.get(p.ticker)?.dy_12m ?? 0),
          0,
        ) / pesoDy
      : null;

  return {
    carteira: { id: carteira.id, nome: carteira.nome },
    patrimonio: carteira.patrimonio,
    sem_cotacao: carteira.sem_cotacao,
    concentracao: {
      por_ativo: ativos,
      por_setor: setores,
      alertas: [
        ...ativos.filter((l) => l.acima).map((l) => ({ tipo: "ativo", ...l })),
        ...setores.filter((l) => l.acima).map((l) => ({ tipo: "setor", ...l })),
      ],
    },
    desvio_da_alocacao: desvioDaAlocacao(carteira, perfil),
    risco: {
      volatilidade_anual: volatilidadeAnual(r),
      drawdown_maximo: drawdownMaximo(r),
      beta: beta(alinhadosC, alinhadosI),
      janela: {
        de: carteira.serie[0]?.data ?? null,
        ate: carteira.serie.at(-1)?.data ?? null,
        pregoes: carteira.serie.length,
      },
      recalculando: carteira.recalculando,
    },
    correlacoes: correlacoes(historicos),
    dy_medio_ponderado: dyMedio === null ? null : Number(dyMedio.toFixed(6)),
    posicoes: carteira.posicoes.map((p) => {
      const i = indicadores.get(p.ticker);
      return {
        ticker: p.ticker,
        fracao: fracaoDe.get(p.ticker) ?? null,
        dy_12m: i?.dy_12m ?? null,
        margem_graham: i?.margem_graham ?? null,
        margem_bazin: i?.margem_bazin ?? null,
        preco_graham: i?.preco_graham ?? null,
        preco_bazin: i?.preco_bazin ?? null,
        data_dos_indicadores: i?.reference_date ?? null,
        link: `/ativo/${p.ticker}`,
      };
    }),
    link: `/carteiras/${carteira.id}`,
  };
}
