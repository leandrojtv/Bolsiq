import type { Candle, Dividend, FundamentalsPeriod } from "@bolsiq/contracts";
import { d, paraMoeda } from "./decimal.js";
import { bazin } from "./precoJusto.js";
import { beta, desempenho, sharpe } from "./desempenho.js";
import { calcularIndicadores, type EntradaDeCalculo } from "./indicadores.js";
import type { Demonstrativo } from "./tipos.js";

export interface Ponto {
  date: string;
  value: string;
}

/** O que o recalculo de um ticker le do market-data. */
export interface DadosDoAtivo {
  ticker: string;
  kind: string;
  /** Periodos anuais do DFP, do mais recente ao mais antigo. */
  anuais: FundamentalsPeriod[];
  /** Ultimo ano de pregoes, sem ajuste: preco e liquidez. */
  velasBrutas: Candle[];
  /** Mesmo periodo ajustado por proventos: retornos. */
  velasAjustadas: Candle[];
  proventos: Dividend[];
  /** CDI do SGS, em % ao dia. */
  cdi: Ponto[];
  /** Nivel do IBOV (ou do BOVA11, como aproximacao). */
  ibov: Ponto[];
  /** Data de hoje, YYYY-MM-DD, para as janelas de proventos. */
  hoje: string;
}

/** Linha de `analytics.indicators`, com razoes como string para o `numeric`. */
export type LinhaDeIndicadores = Record<string, string | number | null> & {
  ticker: string;
  reference_date: string;
  kind: string;
};

const SESSOES_DE_LIQUIDEZ = 21;
/** numeric(18,6) estoura em 10^12; razao desse tamanho e dado quebrado. */
const LIMITE_DE_RAZAO = 1e11;

function somarDias(data: string, dias: number): string {
  const x = new Date(`${data}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + dias);
  return x.toISOString().slice(0, 10);
}

/** Retornos simples diarios de uma serie de niveis, por data do fim. */
function retornosPorData(niveis: { date: string; valor: string }[]): Map<string, number> {
  const saida = new Map<string, number>();
  for (let i = 1; i < niveis.length; i++) {
    const anterior = niveis[i - 1];
    const atual = niveis[i];
    if (!anterior || !atual) continue;
    const base = d(anterior.valor);
    if (base.lte(0)) continue;
    saida.set(atual.date, d(atual.valor).div(base).minus(1).toNumber());
  }
  return saida;
}

/** Proventos em dinheiro por acao: dividendo e JCP. */
function emDinheiro(p: Dividend): boolean {
  return (p.kind === "dividendo" || p.kind === "jcp") && p.value_per_share !== null;
}

/** Soma por ano-calendario dos ultimos `anos` anos completos, do mais antigo ao mais novo. */
export function proventosPorAno(proventos: Dividend[], hoje: string, anos = 5): string[] {
  const anoAtual = Number(hoje.slice(0, 4));
  const somas = new Map<number, ReturnType<typeof d>>();
  for (const p of proventos.filter(emDinheiro)) {
    const ano = Number(p.ex_date.slice(0, 4));
    if (ano >= anoAtual || ano < anoAtual - anos) continue;
    somas.set(ano, (somas.get(ano) ?? d(0)).plus(p.value_per_share as string));
  }
  const saida: string[] = [];
  for (let ano = anoAtual - anos; ano < anoAtual; ano++) {
    saida.push((somas.get(ano) ?? d(0)).toFixed());
  }
  // Ativo listado ha menos tempo: os anos anteriores ao primeiro provento nao
  // sao zero de dividendo, sao ausencia de historico.
  const primeiro = saida.findIndex((v) => !d(v).eq(0));
  return primeiro === -1 ? [] : saida.slice(primeiro);
}

export function proventos12m(proventos: Dividend[], hoje: string): string {
  const inicio = somarDias(hoje, -365);
  return proventos
    .filter((p) => emDinheiro(p) && p.ex_date > inicio && p.ex_date <= hoje)
    .reduce((acc, p) => acc.plus(p.value_per_share as string), d(0))
    .toFixed();
}

/** Demonstrativo do analytics a partir das contas do /v1/fundamentals. */
export function demonstrativoDe(p: FundamentalsPeriod): Demonstrativo | null {
  if (
    p.revenue === null ||
    p.ebit === null ||
    p.net_income === null ||
    p.total_assets === null ||
    p.equity === null
  ) {
    return null;
  }
  // Conta ausente que entra em soma (depreciacao, divida) vale zero: banco nao
  // tem emprestimo no passivo como industria tem. As que entram em razao
  // propria (margem bruta, liquidez) sao anuladas depois do calculo.
  return {
    reference_date: p.reference_date,
    receita: p.revenue,
    resultado_bruto: p.gross_profit ?? "0",
    ebit: p.ebit,
    lucro_liquido: p.net_income,
    depreciacao_amortizacao: p.depreciation_amortization ?? "0",
    ativo_total: p.total_assets,
    ativo_circulante: p.current_assets ?? "0",
    caixa_equivalentes: p.cash_and_equivalents ?? "0",
    passivo_circulante: p.current_liabilities ?? "0",
    patrimonio_liquido: p.equity,
    divida_bruta: p.gross_debt ?? "0",
  };
}

/** Faixa de P/VP plausivel. A razao entre os extremos (800) e menor que 1000. */
const PVP_MIN = 0.05;
const PVP_MAX = 40;

/**
 * Corrige a escala do numero de acoes.
 *
 * O `composicao_capital` da CVM mistura unidades e milhares no mesmo arquivo,
 * sem coluna que diga qual: no DFP 2025, 261 de 668 companhias informam em
 * milhares (Cyrela: 366.311 em vez de 366 milhoes; Vale: 4.268.779). Usar o
 * numero cru da P/L perto de zero e o screener devolve essas empresas no topo.
 *
 * O teste e o P/VP: com a escala certa ele cai entre 0,05 e 40; com a errada,
 * fica mil vezes fora. Como a faixa e mais estreita que o fator, no maximo uma
 * escala passa. Nenhuma passando (patrimonio negativo, preco quebrado), devolve
 * `null`, e os indicadores por acao ficam indefinidos em vez de errados.
 */
export function acoesNaEscalaCerta(
  acoes: number,
  preco: string,
  patrimonio: string,
): number | null {
  const pl = d(patrimonio);
  if (acoes <= 0 || pl.lte(0) || d(preco).lte(0)) return null;
  for (const candidata of [acoes, acoes * 1000]) {
    const pvp = d(preco).times(candidata).div(pl).toNumber();
    if (pvp >= PVP_MIN && pvp <= PVP_MAX) return candidata;
  }
  return null;
}

function razao(v: number | null | undefined): string | null {
  if (
    v === null ||
    v === undefined ||
    !Number.isFinite(v) ||
    Math.abs(v) >= LIMITE_DE_RAZAO
  ) {
    return null;
  }
  return String(v);
}

/**
 * Calcula os indicadores de um ticker.
 *
 * Com demonstrativo (acao), calcula tudo. Sem (FII, ETF, BDR), calcula o que
 * so depende de preco e provento: desempenho, dividend yield e Bazin. `null`
 * quando nao ha preco.
 */
export function recalcular(dados: DadosDoAtivo): LinhaDeIndicadores | null {
  const ultima = dados.velasBrutas.at(-1);
  if (!ultima) return null;
  const preco = ultima.close;

  const niveis = dados.velasAjustadas.map((v) => ({ date: v.date, valor: v.close }));
  const retornos = retornosPorData(niveis);
  const datas = [...retornos.keys()];
  const ativo = datas.map((x) => retornos.get(x) as number);

  // Sharpe e beta exigem series alinhadas pela data: so entram os dias que
  // existem nas duas.
  const cdiPorData = new Map(
    dados.cdi.map((p) => [p.date, d(p.value).div(100).toNumber()]),
  );
  const ibovRet = retornosPorData(
    dados.ibov.map((p) => ({ date: p.date, valor: p.value })),
  );
  const comCdi = datas.filter((x) => cdiPorData.has(x));
  const comIbov = datas.filter((x) => ibovRet.has(x));

  const base = desempenho({ ativo });
  const indicadoresDeDesempenho = {
    ...base,
    sharpe:
      comCdi.length > 20
        ? sharpe(
            comCdi.map((x) => retornos.get(x) as number),
            comCdi.map((x) => cdiPorData.get(x) as number),
          )
        : null,
    beta:
      comIbov.length > 20
        ? beta(
            comIbov.map((x) => retornos.get(x) as number),
            comIbov.map((x) => ibovRet.get(x) as number),
          )
        : null,
  };

  const recentes = dados.velasBrutas.slice(-SESSOES_DE_LIQUIDEZ);
  const liquidez = recentes
    .reduce((acc, v) => acc.plus(v.financial_volume), d(0))
    .div(Math.max(recentes.length, 1));

  const p12m = proventos12m(dados.proventos, dados.hoje);
  const porAno = proventosPorAno(dados.proventos, dados.hoje);

  const periodo = dados.anuais.find((p) => demonstrativoDe(p) !== null);
  const dem = periodo ? demonstrativoDe(periodo) : null;
  const acoes =
    periodo?.shares_outstanding && dem
      ? acoesNaEscalaCerta(periodo.shares_outstanding, preco, dem.patrimonio_liquido)
      : null;

  const comum = {
    ticker: dados.ticker,
    kind: dados.kind,
    preco,
    retorno_periodo: razao(indicadoresDeDesempenho.retorno_periodo),
    volatilidade_anual: razao(indicadoresDeDesempenho.volatilidade_anual),
    drawdown_maximo: razao(indicadoresDeDesempenho.drawdown_maximo),
    sharpe: razao(indicadoresDeDesempenho.sharpe),
    beta: razao(indicadoresDeDesempenho.beta),
    liquidez_diaria: paraMoeda(liquidez),
  };

  if (!dem || !periodo || acoes === null || acoes <= 0) {
    const b = bazin(porAno, preco);
    const dy = d(preco).gt(0) ? d(p12m).div(preco).toNumber() : null;
    const media =
      porAno.length > 0 && d(preco).gt(0)
        ? porAno
            .reduce((acc, v) => acc.plus(v), d(0))
            .div(porAno.length)
            .div(preco)
            .toNumber()
        : null;
    return {
      ...comum,
      reference_date: ultima.date,
      dy_12m: razao(dy),
      dy_medio_5a: razao(media),
      preco_bazin: b.valor,
      margem_bazin: razao(b.margem_seguranca),
      fonte_demonstrativo: null,
    };
  }

  const historico = [...dados.anuais]
    .reverse()
    .map(demonstrativoDe)
    .filter((x): x is Demonstrativo => x !== null);

  const entrada: EntradaDeCalculo = {
    demonstrativo: dem,
    mercado: { preco, acoes, proventos_12m: p12m, proventos_por_ano: porAno },
    historico_receita: historico.map((h) => h.receita),
    historico_lucro: historico.map((h) => h.lucro_liquido),
    retornos: { ativo },
  };
  const ind = calcularIndicadores(entrada);

  return {
    ...comum,
    reference_date: periodo.reference_date,
    lpa: ind.lpa,
    vpa: ind.vpa,
    ebitda: ind.ebitda,
    divida_liquida: ind.divida_liquida,
    pl: razao(ind.pl),
    pvp: razao(ind.pvp),
    ev_ebitda: razao(ind.ev_ebitda),
    ev_ebit: razao(ind.ev_ebit),
    p_receita: razao(ind.p_receita),
    dy_12m: razao(ind.dy_12m),
    dy_medio_5a: razao(ind.dy_medio_5a),
    roe: razao(ind.roe),
    roic: razao(ind.roic),
    roa: razao(ind.roa),
    margem_bruta: periodo.gross_profit === null ? null : razao(ind.margem_bruta),
    margem_ebitda: razao(ind.margem_ebitda),
    margem_liquida: razao(ind.margem_liquida),
    dl_ebitda: razao(ind.dl_ebitda),
    dl_pl: razao(ind.dl_pl),
    liquidez_corrente:
      periodo.current_assets === null || periodo.current_liabilities === null
        ? null
        : razao(ind.liquidez_corrente),
    cagr_receita_5a: razao(ind.cagr_receita_5a),
    cagr_lucro_5a: razao(ind.cagr_lucro_5a),
    preco_graham: ind.preco_graham,
    margem_graham: razao(ind.margem_graham),
    preco_bazin: ind.preco_bazin,
    margem_bazin: razao(ind.margem_bazin),
    fonte_demonstrativo: `cvm-dfp:${periodo.reference_date}:v${periodo.version}`,
  };
}
