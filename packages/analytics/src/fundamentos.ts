import type { Decimal } from "decimal.js";
import { d, dividir, paraMoeda, paraNumero } from "./decimal.js";
import type { DadosDeMercado, Demonstrativo } from "./tipos.js";

export interface Derivados {
  ebitda: Decimal;
  divida_liquida: Decimal;
  valor_de_mercado: Decimal;
  enterprise_value: Decimal;
  lpa: Decimal | null;
  vpa: Decimal | null;
}

export function derivar(dem: Demonstrativo, mkt: DadosDeMercado): Derivados {
  const acoes = d(mkt.acoes);
  const ebitda = d(dem.ebit).plus(d(dem.depreciacao_amortizacao));
  const divida_liquida = d(dem.divida_bruta).minus(d(dem.caixa_equivalentes));
  const valor_de_mercado = d(mkt.preco).times(acoes);

  return {
    ebitda,
    divida_liquida,
    valor_de_mercado,
    // EV soma a divida liquida porque quem compra a empresa assume a divida e
    // fica com o caixa. Divida liquida negativa reduz o EV.
    enterprise_value: valor_de_mercado.plus(divida_liquida),
    lpa: dividir(d(dem.lucro_liquido), acoes),
    vpa: dividir(d(dem.patrimonio_liquido), acoes),
  };
}

export interface Valuation {
  pl: number | null;
  pvp: number | null;
  ev_ebitda: number | null;
  ev_ebit: number | null;
  p_receita: number | null;
  dy_12m: number | null;
  dy_medio_5a: number | null;
}

export function valuation(
  dem: Demonstrativo,
  mkt: DadosDeMercado,
  der = derivar(dem, mkt),
): Valuation {
  const preco = d(mkt.preco);

  return {
    pl: paraNumero(der.lpa === null ? null : dividir(preco, der.lpa)),
    pvp: paraNumero(der.vpa === null ? null : dividir(preco, der.vpa)),
    ev_ebitda: paraNumero(dividir(der.enterprise_value, der.ebitda)),
    ev_ebit: paraNumero(dividir(der.enterprise_value, d(dem.ebit))),
    p_receita: paraNumero(dividir(der.valor_de_mercado, d(dem.receita))),
    dy_12m:
      mkt.proventos_12m === undefined
        ? null
        : paraNumero(dividir(d(mkt.proventos_12m), preco)),
    dy_medio_5a: dyMedio(mkt, preco),
  };
}

function dyMedio(mkt: DadosDeMercado, preco: Decimal): number | null {
  const anos = mkt.proventos_por_ano;
  if (!anos || anos.length === 0) return null;

  const ultimos = anos.slice(-5);
  const soma = ultimos.reduce((acc, v) => acc.plus(d(v)), d(0));
  return paraNumero(dividir(soma.div(ultimos.length), preco));
}

export interface Rentabilidade {
  roe: number | null;
  roic: number | null;
  roa: number | null;
  margem_bruta: number | null;
  margem_ebitda: number | null;
  margem_liquida: number | null;
}

/**
 * Aliquota usada no ROIC. 34% e a soma de IRPJ (25%) e CSLL (9%) no regime
 * geral brasileiro. Aliquota efetiva varia por empresa; usar a nominal mantem
 * o indicador comparavel entre empresas, que e para o que ele serve aqui.
 */
export const ALIQUOTA_NOMINAL = 0.34;

export function rentabilidade(
  dem: Demonstrativo,
  der: Derivados,
  aliquota = ALIQUOTA_NOMINAL,
): Rentabilidade {
  const receita = d(dem.receita);
  const nopat = d(dem.ebit).times(1 - aliquota);
  // Capital investido = PL + divida liquida. Mede o retorno sobre o capital
  // que a operacao de fato usa, nao sobre o ativo total.
  const capital_investido = d(dem.patrimonio_liquido).plus(der.divida_liquida);

  return {
    roe: paraNumero(dividir(d(dem.lucro_liquido), d(dem.patrimonio_liquido))),
    roic: paraNumero(dividir(nopat, capital_investido)),
    roa: paraNumero(dividir(d(dem.lucro_liquido), d(dem.ativo_total))),
    margem_bruta: paraNumero(dividir(d(dem.resultado_bruto), receita)),
    margem_ebitda: paraNumero(dividir(der.ebitda, receita)),
    margem_liquida: paraNumero(dividir(d(dem.lucro_liquido), receita)),
  };
}

export interface Endividamento {
  divida_liquida: string;
  dl_ebitda: number | null;
  dl_pl: number | null;
  liquidez_corrente: number | null;
}

export function endividamento(dem: Demonstrativo, der: Derivados): Endividamento {
  return {
    divida_liquida: paraMoeda(der.divida_liquida) ?? "0",
    dl_ebitda: paraNumero(dividir(der.divida_liquida, der.ebitda)),
    dl_pl: paraNumero(dividir(der.divida_liquida, d(dem.patrimonio_liquido))),
    liquidez_corrente: paraNumero(
      dividir(d(dem.ativo_circulante), d(dem.passivo_circulante)),
    ),
  };
}

/**
 * CAGR entre o primeiro e o ultimo valor da serie.
 *
 * Devolve null quando o valor inicial nao e positivo: nao existe taxa de
 * crescimento composta a partir de base zero ou negativa, e uma empresa que
 * saiu de prejuizo para lucro nao tem CAGR de lucro definido. Inventar um
 * numero ali e o jeito mais facil de um screener mentir.
 */
export function cagr(serie: string[], anos?: number): number | null {
  if (serie.length < 2) return null;

  const inicial = d(serie[0] ?? "0");
  const final = d(serie[serie.length - 1] ?? "0");
  const periodos = anos ?? serie.length - 1;

  if (inicial.lte(0) || periodos <= 0) return null;
  if (final.lte(0)) return null;

  return paraNumero(
    final
      .div(inicial)
      .toPower(1 / periodos)
      .minus(1),
  );
}
