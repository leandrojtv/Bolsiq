import type { Decimal } from "decimal.js";
import { d, moeda } from "../decimal.js";
import type { Contexto, Insight } from "./tipos.js";
import {
  brl,
  despesaRealizada,
  fimDoMes,
  idDeInsight,
  inicioDoMes,
  pct,
  receitaRealizada,
  soma,
} from "./util.js";

export interface ItemDoRanking {
  chave: string;
  nome: string;
  valor: string;
  pct_do_gasto: number;
  pct_da_renda: number | null;
  lancamentos: number;
}

/** Quantos itens, do maior para o menor, somam pelo menos 80% do total. */
export function concentracao(valores: Decimal[], limite = 0.8): number {
  const total = valores.reduce((s, v) => s.plus(v), d(0));
  if (total.isZero()) return 0;
  let acumulado = d(0);
  const ordenados = [...valores].sort((a, b) => b.comparedTo(a));
  for (let i = 0; i < ordenados.length; i++) {
    acumulado = acumulado.plus(ordenados[i]!);
    if (acumulado.div(total).gte(limite)) return i + 1;
  }
  return ordenados.length;
}

function agrupar(
  itens: { chave: string; nome: string; valor: string }[],
  total: Decimal,
  renda: Decimal,
): ItemDoRanking[] {
  const grupos = new Map<string, { nome: string; valor: Decimal; n: number }>();
  for (const i of itens) {
    const g = grupos.get(i.chave) ?? { nome: i.nome, valor: d(0), n: 0 };
    g.valor = g.valor.plus(i.valor);
    g.n++;
    grupos.set(i.chave, g);
  }
  return [...grupos.entries()]
    .sort((a, b) => b[1].valor.comparedTo(a[1].valor) || a[0].localeCompare(b[0]))
    .map(([chave, g]) => ({
      chave,
      nome: g.nome,
      valor: moeda(g.valor),
      pct_do_gasto: pct(g.valor, total) ?? 0,
      pct_da_renda: pct(g.valor, renda),
      lancamentos: g.n,
    }));
}

/**
 * Ranking de gastos do mes: categorias e estabelecimentos por valor, % do
 * gasto e da renda, e concentracao (quantos itens somam 80% do gasto).
 * Informativo: nao propoe economia, por isso impacto zero.
 */
export function rankingDeGastos(ctx: Contexto): Insight[] {
  const inicio = inicioDoMes(ctx.mes);
  const doMes = ctx.lancamentos.filter((l) => l.competencia === inicio);
  const despesas = doMes.filter(despesaRealizada);
  if (despesas.length === 0) return [];
  const total = soma(despesas);
  const renda = soma(doMes.filter(receitaRealizada));
  const categorias = agrupar(
    despesas.map((l) => ({
      chave: l.category_id ?? "",
      nome: (l.category_id && ctx.categorias.get(l.category_id)?.nome) || "Sem categoria",
      valor: l.valor,
    })),
    total,
    renda,
  );
  const estabelecimentos = agrupar(
    despesas.map((l) => ({
      chave: l.descricao_normalizada,
      nome: l.descricao,
      valor: l.valor,
    })),
    total,
    renda,
  );
  const nCat = concentracao(categorias.map((c) => d(c.valor)));
  const nEst = concentracao(estabelecimentos.map((c) => d(c.valor)));
  const maior = categorias[0]!;
  const daRenda = pct(total, renda);
  return [
    {
      id: idDeInsight("ranking", ctx.mes),
      tipo: "ranking",
      titulo: `${maior.nome} é onde você mais gasta`,
      descricao:
        `${maior.nome} somou ${brl(maior.valor)} (${maior.pct_do_gasto}% das despesas do mês). ` +
        `${nCat} de ${categorias.length} categorias e ${nEst} de ${estabelecimentos.length} estabelecimentos concentram 80% do gasto` +
        (daRenda === null ? "." : `, que foi ${daRenda}% da renda.`),
      impacto_mensal: "0.00",
      impacto_anual: "0.00",
      severidade: "info",
      evidencias: despesas.map((l) => l.id),
      acao_sugerida: `Comece revisando as ${nCat} categorias que somam 80% do gasto.`,
      periodo: { inicio, fim: fimDoMes(ctx.mes) },
      dados: {
        total: moeda(total),
        renda: moeda(renda),
        pct_da_renda: daRenda,
        categorias,
        estabelecimentos: estabelecimentos.slice(0, 10),
        concentracao: {
          categorias: nCat,
          total_categorias: categorias.length,
          estabelecimentos: nEst,
          total_estabelecimentos: estabelecimentos.length,
        },
      },
    },
  ];
}
