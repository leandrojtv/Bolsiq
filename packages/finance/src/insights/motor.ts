import { d } from "../decimal.js";
import { somarDias } from "../recorrencia.js";
import {
  detectarAssinaturas,
  insightsDeAssinaturas,
  type Assinatura,
} from "./assinaturas.js";
import { essencialXSuperfluo } from "./essencial.js";
import { efeitoFormiga } from "./formiga.js";
import { categoriasForaDoPadrao, transacoesAtipicas } from "./fora-do-padrao.js";
import { rankingDeGastos } from "./ranking.js";
import { tarifasEJuros } from "./tarifas.js";
import type { AcaoDeFeedback, Contexto, Insight, Novidade, Severidade } from "./tipos.js";
import { diasEntre, inicioDoMes } from "./util.js";

const PESO: Record<Severidade, number> = { alta: 0, media: 1, baixa: 2, info: 3 };

/** Ordem: impacto anual, depois severidade, depois id (deterministico). */
export function ordenar(insights: Insight[]): Insight[] {
  return [...insights].sort(
    (a, b) =>
      d(b.impacto_anual).comparedTo(a.impacto_anual) ||
      PESO[a.severidade] - PESO[b.severidade] ||
      a.id.localeCompare(b.id),
  );
}

/** Primeiro dia que os detectores leem: 6 meses antes do mes e 400 dias antes de hoje. */
export function inicioDaJanela(mes: string, hoje: string): string {
  const a = inicioDoMes(mes, -6);
  const b = somarDias(hoje, -400);
  return a < b ? a : b;
}

export function gerarInsights(ctx: Contexto): {
  insights: Insight[];
  assinaturas: Assinatura[];
} {
  const assinaturas = detectarAssinaturas(ctx);
  return {
    assinaturas,
    insights: ordenar([
      ...insightsDeAssinaturas(assinaturas, ctx),
      ...tarifasEJuros(ctx),
      ...efeitoFormiga(ctx, new Set(assinaturas.flatMap((a) => a.evidencias))),
      ...categoriasForaDoPadrao(ctx),
      ...transacoesAtipicas(ctx),
      ...essencialXSuperfluo(ctx),
      ...rankingDeGastos(ctx),
    ]),
  };
}

export interface Feedback {
  insight_id: string;
  acao: AcaoDeFeedback;
  /** Impacto anual do insight quando o usuario respondeu. */
  impacto_anual: string;
  /** YYYY-MM-DD */
  registrado_em: string;
}

export type InsightComFeedback = Insight & {
  feedback: { acao: AcaoDeFeedback; registrado_em: string } | null;
};

const DIAS_DISPENSADO = 90;
const AUMENTO_QUE_REABRE = 1.2;

/**
 * Dispensado (ou "ainda uso") nao volta por 90 dias, a nao ser que o impacto
 * anual suba mais de 20%. "Ja cancelei" some ate aparecer cobranca depois da
 * resposta. "Vou cancelar" continua visivel, com a marca.
 */
export function visivel(i: Insight, f: Feedback | undefined, hoje: string): boolean {
  if (!f || f.acao === "vou_cancelar") return true;
  if (f.acao === "ja_cancelei") {
    const ultima = (i.dados.assinatura as Assinatura | undefined)?.ultima;
    return ultima !== undefined && ultima > f.registrado_em;
  }
  if (diasEntre(f.registrado_em, hoje) >= DIAS_DISPENSADO) return true;
  return d(i.impacto_anual).gt(d(f.impacto_anual).times(AUMENTO_QUE_REABRE));
}

export function aplicarFeedback(
  insights: Insight[],
  feedbacks: Feedback[],
  hoje: string,
): { visiveis: InsightComFeedback[]; ocultos: number } {
  const porId = new Map(feedbacks.map((f) => [f.insight_id, f]));
  const visiveis: InsightComFeedback[] = [];
  for (const i of insights) {
    const f = porId.get(i.id);
    if (visivel(i, f, hoje))
      visiveis.push({
        ...i,
        feedback: f ? { acao: f.acao, registrado_em: f.registrado_em } : null,
      });
  }
  return { visiveis, ocultos: insights.length - visiveis.length };
}

export interface NovidadeDeInsight {
  /** Chave do anuncio: o mesmo fato nao vira dois eventos. */
  chave: string;
  motivo: Novidade;
  insight: Insight;
}

/** O que vira `finance.insight.novo.v1`: assinatura nova, reajuste e tarifa nova. */
export function novidades(insights: Insight[]): NovidadeDeInsight[] {
  const r: NovidadeDeInsight[] = [];
  for (const i of insights) {
    const a = i.dados.assinatura as Assinatura | undefined;
    if (a?.nova)
      r.push({ chave: `assinatura_nova:${i.id}`, motivo: "assinatura_nova", insight: i });
    if (a?.reajuste)
      r.push({
        chave: `reajuste:${i.id}:${a.reajuste.para}`,
        motivo: "reajuste",
        insight: i,
      });
    if (i.tipo === "tarifas")
      for (const n of i.dados.novas as { chave: string; data: string }[])
        r.push({
          chave: `tarifa_nova:${n.chave}:${n.data}`,
          motivo: "tarifa_nova",
          insight: i,
        });
  }
  return r;
}
