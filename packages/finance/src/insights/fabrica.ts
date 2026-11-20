import { CATEGORIAS_PADRAO } from "../categorias-padrao.js";
import { normalizarDescricao } from "../dominio.js";
import {
  CONFIGURACAO_PADRAO,
  type CategoriaDeInsight,
  type Contexto,
  type LancamentoDeInsight,
} from "./tipos.js";

/** Fabrica dos testes dos detectores: categorias padrao com id igual ao nome. */

export const CATEGORIAS = new Map<string, CategoriaDeInsight>(
  CATEGORIAS_PADRAO.map((c) => [
    c.nome,
    {
      id: c.nome,
      nome: c.nome,
      natureza: c.natureza,
      tipo_custo: c.tipo_custo,
      essencial: c.essencial,
      sistema: c.sistema,
    },
  ]),
);

let seq = 0;

export function lanc(
  p: Partial<LancamentoDeInsight> & { data: string; valor: string },
): LancamentoDeInsight {
  const descricao = p.descricao ?? "LOJA";
  return {
    id: p.id ?? `t${String(++seq).padStart(4, "0")}`,
    tipo: "despesa",
    status: "realizado",
    competencia: `${p.data.slice(0, 7)}-01`,
    descricao,
    descricao_normalizada: normalizarDescricao(descricao),
    category_id: null,
    account_id: "conta",
    card_id: null,
    transferencia_sentido: null,
    conta_tipo: "corrente",
    parcelado: false,
    ...p,
  };
}

/** Mesma descricao e valor em cada data. */
export const serie = (
  descricao: string,
  valor: string,
  datas: string[],
  extra: Partial<LancamentoDeInsight> = {},
) => datas.map((data) => lanc({ descricao, valor, data, ...extra }));

export function contexto(
  lancamentos: LancamentoDeInsight[],
  extra: Partial<Contexto> = {},
): Contexto {
  return {
    lancamentos,
    categorias: CATEGORIAS,
    mes: "2026-11",
    hoje: "2026-11-20",
    config: CONFIGURACAO_PADRAO,
    ...extra,
  };
}
