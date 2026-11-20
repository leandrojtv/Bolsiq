import { d, moeda } from "../decimal.js";

/** CDI do /v1/macro/cdi (BCB SGS 12): % ao dia util, com a data do ponto. */
export interface TaxaCdi {
  /** % no dia util, como o SGS publica (ex.: "0.050788"). */
  diaria: string;
  data: string;
  fonte: string;
}

export interface CustoDeOportunidade {
  valor_mensal: string;
  taxa_anual: number;
  taxa_mensal: number;
  data_da_taxa: string;
  fonte: string;
  premissa: string;
  em_5_anos: { acumulado: string; aportado: string; rendimento: string };
  em_10_anos: { acumulado: string; aportado: string; rendimento: string };
}

const DIAS_UTEIS = 252;

/** Taxa anual equivalente: (1 + d)^252 - 1. */
export function cdiAnual(diaria: string): number {
  return d(diaria).div(100).plus(1).pow(DIAS_UTEIS).minus(1).toNumber();
}

/**
 * Quanto o valor mensal acumularia aplicado todo fim de mes a 100% do CDI
 * atual, sem imposto nem inflacao: valor futuro de uma serie de pagamentos.
 */
export function custoDeOportunidade(
  valorMensal: string,
  cdi: TaxaCdi,
): CustoDeOportunidade {
  const anual = d(cdiAnual(cdi.diaria));
  const mensal = anual.plus(1).pow(d(1).div(12)).minus(1);
  const p = d(valorMensal);
  const em = (meses: number) => {
    const acumulado = mensal.isZero()
      ? p.times(meses)
      : p.times(mensal.plus(1).pow(meses).minus(1).div(mensal));
    const aportado = p.times(meses);
    return {
      acumulado: moeda(acumulado),
      aportado: moeda(aportado),
      rendimento: moeda(acumulado.minus(aportado)),
    };
  };
  const taxaAnual = Number(anual.times(100).toFixed(2));
  const dataBr = cdi.data.split("-").reverse().join("/");
  return {
    valor_mensal: moeda(p),
    taxa_anual: taxaAnual,
    taxa_mensal: Number(mensal.times(100).toFixed(4)),
    data_da_taxa: cdi.data,
    fonte: cdi.fonte,
    premissa: `100% do CDI de ${dataBr} (${taxaAnual.toLocaleString("pt-BR")}% ao ano), aplicado todo mês, sem imposto e sem inflação.`,
    em_5_anos: em(60),
    em_10_anos: em(120),
  };
}
