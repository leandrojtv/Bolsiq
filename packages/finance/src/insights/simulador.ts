import { d, moeda } from "../decimal.js";
import type { FluxoProjetado } from "../fluxo.js";
import {
  custoDeOportunidade,
  type CustoDeOportunidade,
  type TaxaCdi,
} from "./oportunidade.js";

/** O que o simulador oferece para cortar, calculado no servidor. */
export interface BaseDoSimulador {
  assinaturas: { id: string; nome: string; valor_mensal: string }[];
  /** Media mensal dos 3 meses completos anteriores, por categoria de despesa. */
  categorias: { category_id: string; nome: string; media_mensal: string }[];
  formiga: { mensal: string } | null;
  fluxo: FluxoProjetado;
  metas: { id: string; nome: string; falta: string; valor_mensal_necessario: string }[];
  cdi: TaxaCdi | null;
}

export type Corte =
  | { tipo: "assinatura"; id: string }
  | { tipo: "categoria"; category_id: string; reducao_pct: number }
  | { tipo: "formiga"; reducao_pct: number };

export interface ResultadoDosCortes {
  itens: { tipo: Corte["tipo"]; id: string; nome: string; economia_mensal: string }[];
  economia_mensal: string;
  economia_anual: string;
  fluxo: { base: FluxoProjetado; novo: FluxoProjetado };
  metas: {
    id: string;
    nome: string;
    meses_base: number;
    meses_com_corte: number;
    meses_antes: number;
  }[];
  oportunidade: CustoDeOportunidade | null;
}

const fracao = (p: number) => d(Math.min(100, Math.max(0, p))).div(100);

/**
 * Simulador de cortes: economia mensal e anual, fluxo projetado com a economia
 * a partir do mes seguinte e quantos meses antes cada meta chega. Premissa da
 * meta: voce guarda o necessario por mes (o que a meta pede) mais a economia.
 */
export function simularCortes(
  base: BaseDoSimulador,
  cortes: Corte[],
): ResultadoDosCortes {
  const itens: ResultadoDosCortes["itens"] = [];
  for (const c of cortes) {
    if (c.tipo === "assinatura") {
      const a = base.assinaturas.find((x) => x.id === c.id);
      if (a)
        itens.push({
          tipo: c.tipo,
          id: a.id,
          nome: a.nome,
          economia_mensal: a.valor_mensal,
        });
    } else if (c.tipo === "categoria") {
      const cat = base.categorias.find((x) => x.category_id === c.category_id);
      if (cat)
        itens.push({
          tipo: c.tipo,
          id: cat.category_id,
          nome: `${cat.nome} (-${c.reducao_pct}%)`,
          economia_mensal: moeda(d(cat.media_mensal).times(fracao(c.reducao_pct))),
        });
    } else if (base.formiga) {
      itens.push({
        tipo: c.tipo,
        id: "formiga",
        nome: `Efeito formiga (-${c.reducao_pct}%)`,
        economia_mensal: moeda(d(base.formiga.mensal).times(fracao(c.reducao_pct))),
      });
    }
  }
  const economia = itens.reduce((s, i) => s.plus(i.economia_mensal), d(0));

  let negativo: string | null = null;
  const meses = base.fluxo.meses.map((m, i) => {
    const saldo = d(m.saldo_final).plus(economia.times(i));
    if (negativo === null && saldo.lt(0)) negativo = m.mes;
    const saidas = i === 0 ? d(m.saidas) : d(m.saidas).minus(economia);
    return {
      ...m,
      saidas: moeda(saidas.lt(0) ? d(0) : saidas),
      saldo_final: moeda(saldo),
    };
  });

  const metas = base.metas.map((m) => {
    const falta = d(m.falta);
    const aporte = d(m.valor_mensal_necessario);
    const meses = (por: ReturnType<typeof d>) =>
      falta.lte(0) || por.lte(0) ? 0 : falta.div(por).ceil().toNumber();
    const meses_base = meses(aporte);
    const meses_com_corte = meses(aporte.plus(economia));
    return {
      id: m.id,
      nome: m.nome,
      meses_base,
      meses_com_corte,
      meses_antes: meses_base - meses_com_corte,
    };
  });

  return {
    itens,
    economia_mensal: moeda(economia),
    economia_anual: moeda(economia.times(12)),
    fluxo: {
      base: base.fluxo,
      novo: { ...base.fluxo, meses, primeiro_mes_negativo: negativo },
    },
    metas,
    oportunidade:
      base.cdi && economia.gt(0) ? custoDeOportunidade(moeda(economia), base.cdi) : null,
  };
}
