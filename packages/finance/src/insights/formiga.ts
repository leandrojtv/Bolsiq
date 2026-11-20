import { d, moeda } from "../decimal.js";
import { somarDias } from "../recorrencia.js";
import { ehTarifa } from "./tarifas.js";
import type { Contexto, Insight, LancamentoDeInsight, Severidade } from "./tipos.js";
import {
  anual,
  brl,
  despesaRealizada,
  idDeInsight,
  receitaRealizada,
  soma,
} from "./util.js";

const JANELA_DIAS = 90;
const MESES_DA_JANELA = 3;
/** Habito: o mesmo estabelecimento pelo menos 3 vezes na janela. */
const MINIMO_DE_VEZES = 3;

interface Grupo {
  chave: string;
  nome: string;
  vezes: number;
  vezes_por_mes: number;
  valor_medio: string;
  mensal: string;
  anual: string;
}

function grupo(chave: string, nome: string, ls: LancamentoDeInsight[]): Grupo {
  const total = soma(ls);
  const mensal = total.div(MESES_DA_JANELA);
  return {
    chave,
    nome,
    vezes: ls.length,
    vezes_por_mes: Number((ls.length / MESES_DA_JANELA).toFixed(1)),
    valor_medio: moeda(total.div(ls.length)),
    mensal: moeda(mensal),
    anual: anual(mensal),
  };
}

/**
 * Efeito formiga: despesas variaveis abaixo do limite (padrao R$ 50) nos
 * ultimos 90 dias, agrupadas por estabelecimento; entram os habitos (3 vezes
 * ou mais). Cobranca de assinatura (ids em `assinaturas`) e tarifa ficam de fora. Frequencia mensal e projecao anual pela media da janela.
 */
export function efeitoFormiga(ctx: Contexto, assinaturas = new Set<string>()): Insight[] {
  const inicio = somarDias(ctx.hoje, -(JANELA_DIAS - 1));
  const limite = d(ctx.config.limite_formiga);
  const naJanela = ctx.lancamentos.filter((l) => l.data >= inicio && l.data <= ctx.hoje);
  const pequenas = naJanela.filter((l) => {
    if (!despesaRealizada(l) || l.parcelado || d(l.valor).gte(limite)) return false;
    if (assinaturas.has(l.id) || ehTarifa(l, ctx.categorias)) return false;
    const cat = l.category_id ? ctx.categorias.get(l.category_id) : undefined;
    return cat?.tipo_custo !== "fixo";
  });
  const porEstabelecimento = new Map<string, LancamentoDeInsight[]>();
  for (const l of pequenas)
    porEstabelecimento.set(l.descricao_normalizada, [
      ...(porEstabelecimento.get(l.descricao_normalizada) ?? []),
      l,
    ]);
  const habitos = [...porEstabelecimento.entries()].filter(
    ([, ls]) => ls.length >= MINIMO_DE_VEZES,
  );
  if (habitos.length === 0) return [];

  const compras = habitos.flatMap(([, ls]) => ls);
  const estabelecimentos = habitos
    .map(([chave, ls]) => grupo(chave, ls.at(-1)!.descricao, ls))
    .sort((a, b) => d(b.mensal).comparedTo(a.mensal) || a.chave.localeCompare(b.chave));
  const porCategoria = new Map<string, LancamentoDeInsight[]>();
  for (const l of compras)
    porCategoria.set(l.category_id ?? "", [
      ...(porCategoria.get(l.category_id ?? "") ?? []),
      l,
    ]);
  const categorias = [...porCategoria.entries()]
    .map(([id, ls]) =>
      grupo(id, (id && ctx.categorias.get(id)?.nome) || "Sem categoria", ls),
    )
    .sort((a, b) => d(b.mensal).comparedTo(a.mensal) || a.chave.localeCompare(b.chave));

  const mensal = soma(compras).div(MESES_DA_JANELA);
  const rendaMensal = soma(naJanela.filter(receitaRealizada)).div(MESES_DA_JANELA);
  const peso = rendaMensal.isZero() ? null : mensal.div(rendaMensal);
  const severidade: Severidade = peso
    ? peso.gte(0.1)
      ? "alta"
      : peso.gte(0.05)
        ? "media"
        : "baixa"
    : mensal.gte(300)
      ? "alta"
      : mensal.gte(100)
        ? "media"
        : "baixa";
  const principais = estabelecimentos.slice(0, 2).map((e) => e.nome);
  return [
    {
      id: idDeInsight("formiga", "90d"),
      tipo: "formiga",
      titulo: `Efeito formiga: ${brl(mensal)} por mês em compras pequenas`,
      descricao:
        `${compras.length} compras abaixo de ${brl(limite)} em ${habitos.length} lugares que viraram hábito nos últimos ${JANELA_DIAS} dias. ` +
        `No ritmo atual, são ${brl(mensal.times(12))} por ano.`,
      impacto_mensal: moeda(mensal),
      impacto_anual: anual(mensal),
      severidade,
      evidencias: compras.map((l) => l.id),
      acao_sugerida: `Defina um teto semanal para ${principais.join(" e ")}. Cortar metade economiza ${brl(mensal.times(6))} por ano.`,
      periodo: { inicio, fim: ctx.hoje },
      dados: {
        limite: moeda(limite),
        estabelecimentos,
        categorias,
        pct_da_renda: peso ? Number(peso.times(100).toFixed(1)) : null,
      },
    },
  ];
}
