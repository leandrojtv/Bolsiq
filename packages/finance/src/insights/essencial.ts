import { d, moeda } from "../decimal.js";
import type { Contexto, Insight, LancamentoDeInsight, Severidade } from "./tipos.js";
import {
  anual,
  brl,
  despesaRealizada,
  fimDoMes,
  idDeInsight,
  inicioDoMes,
  pct,
  receitaRealizada,
  soma,
} from "./util.js";

const CATEGORIA_DE_APORTE = /invest|aporte|poupan/i;

/** Aporte: despesa numa categoria de investimento ou entrada em poupanca ou corretora. */
export function ehAporte(l: LancamentoDeInsight, ctx: Contexto): boolean {
  if (l.status === "previsto") return false;
  if (l.tipo === "transferencia")
    return (
      l.transferencia_sentido === "entrada" &&
      (l.conta_tipo === "poupanca" || l.conta_tipo === "caixa_corretora")
    );
  const nome = l.category_id ? ctx.categorias.get(l.category_id)?.nome : undefined;
  return l.tipo === "despesa" && nome !== undefined && CATEGORIA_DE_APORTE.test(nome);
}

/**
 * Essencial x nao essencial x poupanca, em % da renda do mes, contra a
 * referencia (padrao 50/30/20). Essencial e a marca da categoria; sem
 * categoria conta como nao essencial. O impacto e o que passa da referencia
 * nos nao essenciais.
 */
export function essencialXSuperfluo(ctx: Contexto): Insight[] {
  const inicio = inicioDoMes(ctx.mes);
  const doMes = ctx.lancamentos.filter((l) => l.competencia === inicio);
  const renda = soma(doMes.filter(receitaRealizada));
  if (renda.isZero()) return [];
  const aportes = doMes.filter((l) => ehAporte(l, ctx));
  const gastos = doMes.filter((l) => despesaRealizada(l) && !ehAporte(l, ctx));
  const ess = gastos.filter(
    (l) => l.category_id && ctx.categorias.get(l.category_id)?.essencial,
  );
  const naoEss = gastos.filter((l) => !ess.includes(l));
  const v = {
    essenciais: soma(ess),
    nao_essenciais: soma(naoEss),
    poupanca: soma(aportes),
  };
  const ref = ctx.config.referencia;
  const excesso = v.nao_essenciais.minus(renda.times(ref.nao_essenciais).div(100));
  const faltaPoupar = renda.times(ref.poupanca).div(100).minus(v.poupanca);
  const impacto = excesso.gt(0) ? excesso : d(0);
  const severidade: Severidade = excesso.gt(0)
    ? excesso.gte(renda.times(0.1))
      ? "alta"
      : "media"
    : faltaPoupar.gt(0)
      ? "baixa"
      : "info";
  const p = (x: keyof typeof v) => pct(v[x], renda) ?? 0;
  return [
    {
      id: idDeInsight("essencial_superfluo", ctx.mes),
      tipo: "essencial_superfluo",
      titulo: excesso.gt(0)
        ? `Não essenciais em ${p("nao_essenciais")}% da renda (referência ${ref.nao_essenciais}%)`
        : `Divisão da renda: ${p("essenciais")}/${p("nao_essenciais")}/${p("poupanca")}`,
      descricao:
        `Da renda de ${brl(renda)}: ${p("essenciais")}% em essenciais, ${p("nao_essenciais")}% em não essenciais e ${p("poupanca")}% em poupança e investimentos. ` +
        `A referência é ${ref.essenciais}/${ref.nao_essenciais}/${ref.poupanca}.`,
      impacto_mensal: moeda(impacto),
      impacto_anual: anual(impacto),
      severidade,
      evidencias: naoEss.map((l) => l.id),
      acao_sugerida: excesso.gt(0)
        ? `Reduza ${brl(excesso)} por mês nos não essenciais para voltar a ${ref.nao_essenciais}% da renda.`
        : faltaPoupar.gt(0)
          ? `Guarde mais ${brl(faltaPoupar)} por mês para chegar a ${ref.poupanca}% da renda.`
          : "Você está dentro da referência. Mantenha o ritmo.",
      periodo: { inicio, fim: fimDoMes(ctx.mes) },
      dados: {
        renda: moeda(renda),
        valores: {
          essenciais: moeda(v.essenciais),
          nao_essenciais: moeda(v.nao_essenciais),
          poupanca: moeda(v.poupanca),
        },
        percentuais: {
          essenciais: p("essenciais"),
          nao_essenciais: p("nao_essenciais"),
          poupanca: p("poupanca"),
        },
        referencia: ref,
        falta_poupar: moeda(faltaPoupar.gt(0) ? faltaPoupar : d(0)),
      },
    },
  ];
}
