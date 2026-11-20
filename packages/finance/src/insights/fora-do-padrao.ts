import type { Decimal } from "decimal.js";
import { d, moeda } from "../decimal.js";
import type { Contexto, Insight, LancamentoDeInsight, Severidade } from "./tipos.js";
import {
  brl,
  despesaRealizada,
  fimDoMes,
  idDeInsight,
  inicioDoMes,
  mad,
  mediana,
} from "./util.js";

const MESES_ANTERIORES = 6;
/** Sem historico (usuario novo), tudo pareceria fora do padrao. */
const MINIMO_DE_MESES_COM_DADOS = 3;
const FATOR_MAD = 1.5;
const EXCESSO_MINIMO = 100;
const FATOR_ATIPICO = 3;
const MINIMO_DE_COMPRAS_ANTERIORES = 3;

const severidadeDoExcesso = (e: Decimal): Severidade =>
  e.gte(500) ? "alta" : e.gte(200) ? "media" : "baixa";

/**
 * Categoria do mes acima da mediana dos 6 meses anteriores por mais de 1,5 MAD
 * e pelo menos R$ 100. O excesso e pontual: impacto anual igual ao mensal.
 */
export function categoriasForaDoPadrao(ctx: Contexto): Insight[] {
  const atual = inicioDoMes(ctx.mes);
  const meses = Array.from({ length: MESES_ANTERIORES }, (_, i) =>
    inicioDoMes(ctx.mes, i - MESES_ANTERIORES),
  );
  const despesas = ctx.lancamentos.filter(despesaRealizada);
  const comDados = new Set(despesas.map((l) => l.competencia));
  if (meses.filter((m) => comDados.has(m)).length < MINIMO_DE_MESES_COM_DADOS) return [];

  const porCategoria = new Map<string, Map<string, LancamentoDeInsight[]>>();
  for (const l of despesas) {
    if (!l.category_id) continue;
    const c = porCategoria.get(l.category_id) ?? new Map<string, LancamentoDeInsight[]>();
    c.set(l.competencia, [...(c.get(l.competencia) ?? []), l]);
    porCategoria.set(l.category_id, c);
  }
  const insights: Insight[] = [];
  for (const [id, porMes] of porCategoria) {
    const doMes = porMes.get(atual) ?? [];
    if (doMes.length === 0) continue;
    const valor = doMes.reduce((s, l) => s.plus(l.valor), d(0));
    const historico = meses.map((m) =>
      (porMes.get(m) ?? []).reduce((s, l) => s.plus(l.valor), d(0)),
    );
    const med = mediana(historico);
    const desvio = mad(historico);
    const limite = med.plus(desvio.times(FATOR_MAD));
    const excesso = valor.minus(med);
    if (!valor.gt(limite) || excesso.lt(EXCESSO_MINIMO)) continue;
    const nome = ctx.categorias.get(id)?.nome ?? "Categoria";
    insights.push({
      id: idDeInsight("fora_do_padrao", `${ctx.mes}:${id}`),
      tipo: "fora_do_padrao",
      titulo: `${nome} acima do normal neste mês`,
      descricao: `${nome} somou ${brl(valor)} no mês; a mediana dos 6 meses anteriores é ${brl(med)}. São ${brl(excesso)} a mais.`,
      impacto_mensal: moeda(excesso),
      impacto_anual: moeda(excesso),
      severidade: severidadeDoExcesso(excesso),
      evidencias: doMes.map((l) => l.id),
      acao_sugerida: `Veja os lançamentos de ${nome} do mês e segure novos gastos nela até o fim do mês.`,
      periodo: { inicio: atual, fim: fimDoMes(ctx.mes) },
      dados: {
        category_id: id,
        categoria: nome,
        valor: moeda(valor),
        mediana: moeda(med),
        mad: moeda(desvio),
        limite: moeda(limite),
        historico: meses.map((m, i) => ({
          mes: m.slice(0, 7),
          valor: moeda(historico[i]!),
        })),
      },
    });
  }
  return insights;
}

/**
 * Compra do mes maior que 3x a mediana das compras anteriores no mesmo
 * estabelecimento (pelo menos 3 anteriores). Excesso pontual.
 */
export function transacoesAtipicas(ctx: Contexto): Insight[] {
  const atual = inicioDoMes(ctx.mes);
  const porEstabelecimento = new Map<string, LancamentoDeInsight[]>();
  for (const l of ctx.lancamentos)
    if (despesaRealizada(l) && !l.parcelado)
      porEstabelecimento.set(l.descricao_normalizada, [
        ...(porEstabelecimento.get(l.descricao_normalizada) ?? []),
        l,
      ]);
  const insights: Insight[] = [];
  for (const ls of porEstabelecimento.values()) {
    for (const l of ls) {
      if (l.competencia !== atual) continue;
      const antes = ls.filter((o) => o.data < l.data);
      if (antes.length < MINIMO_DE_COMPRAS_ANTERIORES) continue;
      const med = mediana(antes.map((o) => d(o.valor)));
      if (!d(l.valor).gt(med.times(FATOR_ATIPICO))) continue;
      const excesso = d(l.valor).minus(med);
      insights.push({
        id: idDeInsight("transacao_atipica", l.id),
        tipo: "transacao_atipica",
        titulo: `Compra fora do comum em ${l.descricao}`,
        descricao: `${brl(l.valor)} em ${l.data.split("-").reverse().join("/")}, mais de 3 vezes a compra típica ali (${brl(med)}, mediana de ${antes.length} compras).`,
        impacto_mensal: moeda(excesso),
        impacto_anual: moeda(excesso),
        severidade: severidadeDoExcesso(excesso),
        evidencias: [l.id],
        acao_sugerida:
          "Confira se a compra está certa (valor, cobrança em dobro) e se era planejada.",
        periodo: { inicio: atual, fim: fimDoMes(ctx.mes) },
        dados: {
          lancamento_id: l.id,
          estabelecimento: l.descricao_normalizada,
          valor: l.valor,
          mediana: moeda(med),
          compras_anteriores: antes.length,
        },
      });
    }
  }
  return insights;
}
