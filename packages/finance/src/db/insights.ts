import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { NovaRecorrencia, Recorrencia } from "../contratos-planejamento.js";
import { d, moeda } from "../decimal.js";
import type { Assinatura } from "../insights/assinaturas.js";
import type {
  ConfiguracaoDeInsights,
  DetalheDoInsight,
  EvidenciaDoInsight,
  ListaDeAssinaturas,
} from "../insights/contratos.js";
import {
  aplicarFeedback,
  gerarInsights,
  inicioDaJanela,
  novidades,
  type Feedback,
  type InsightComFeedback,
} from "../insights/motor.js";
import type { TaxaCdi } from "../insights/oportunidade.js";
import type { BaseDoSimulador } from "../insights/simulador.js";
import {
  CONFIGURACAO_PADRAO,
  type AcaoDeFeedback,
  type CategoriaDeInsight,
  type Configuracao,
  type Insight,
  type LancamentoDeInsight,
} from "../insights/tipos.js";
import { fimDoMes, inicioDoMes } from "../insights/util.js";
import type { TipoDeConta } from "../tipos.js";
import { fluxoDeCaixa } from "./fluxo.js";
import { listarMetas, type ValorDaCarteira } from "./metas.js";
import { auditar, ErroDeFinancas, type Origem, type Tx } from "./operacoes.js";
import { criarRecorrencia } from "./recorrencias.js";
import {
  accounts,
  cards,
  categories,
  insight_feedback,
  insight_settings,
  insights,
  outbox,
  transactions,
} from "./schema.js";
import { comoUsuario } from "./sessao.js";

/** Fila do pg-boss: recalculo por usuario (apos importacao) ou de todos (diario). */
export const JOB_INSIGHTS = "finance.insights";
export const EVENTO_INSIGHT_NOVO = "finance.insight.novo.v1";

type LinhaDoCache = typeof insights.$inferSelect;

export async function lerConfiguracao(tx: Tx, uid: string): Promise<Configuracao> {
  const [c] = await tx
    .select()
    .from(insight_settings)
    .where(eq(insight_settings.user_id, uid));
  if (!c) return CONFIGURACAO_PADRAO;
  return {
    limite_formiga: c.limite_formiga,
    referencia: {
      essenciais: c.ref_essenciais,
      nao_essenciais: c.ref_nao_essenciais,
      poupanca: c.ref_poupanca,
    },
  };
}

/** Salva os ajustes e descarta o cache: o proximo acesso recalcula. */
export async function salvarConfiguracao(
  tx: Tx,
  uid: string,
  c: ConfiguracaoDeInsights,
  origem?: Origem,
): Promise<Configuracao> {
  const valores = {
    limite_formiga: c.limite_formiga,
    ref_essenciais: c.referencia.essenciais,
    ref_nao_essenciais: c.referencia.nao_essenciais,
    ref_poupanca: c.referencia.poupanca,
    atualizado_em: sql`now()`,
  };
  await tx
    .insert(insight_settings)
    .values({ user_id: uid, ...valores })
    .onConflictDoUpdate({ target: insight_settings.user_id, set: valores });
  await tx.delete(insights).where(eq(insights.user_id, uid));
  await auditar(tx, uid, "insights.configurados", "insight_settings", uid, origem);
  return lerConfiguracao(tx, uid);
}

/**
 * Dia do calculo, quantidade e ultima mudanca dos lancamentos: virar o dia,
 * lancar, editar ou apagar muda a marca e o cache e recalculado.
 */
async function marcaDosDados(tx: Tx, uid: string, hoje: string): Promise<string> {
  const [m] = await tx
    .select({
      v: sql<string>`count(*)::text || ':' || coalesce(max(greatest(${transactions.criada_em}, ${transactions.atualizada_em}))::text, '')`,
    })
    .from(transactions)
    .where(eq(transactions.user_id, uid));
  return `${hoje}|${m?.v ?? ""}`;
}

async function contextoDoUsuario(tx: Tx, uid: string, mes: string, hoje: string) {
  const fim = fimDoMes(mes) > hoje ? fimDoMes(mes) : hoje;
  const linhas = await tx
    .select({
      id: transactions.id,
      tipo: transactions.tipo,
      status: transactions.status,
      valor: transactions.valor,
      data: transactions.data,
      competencia: transactions.competencia,
      descricao: transactions.descricao,
      descricao_normalizada: transactions.descricao_normalizada,
      category_id: transactions.category_id,
      account_id: transactions.account_id,
      card_id: transactions.card_id,
      transferencia_sentido: transactions.transferencia_sentido,
      conta_tipo: accounts.tipo,
      parcelado: sql<boolean>`${transactions.installment_plan_id} is not null`,
    })
    .from(transactions)
    .leftJoin(
      accounts,
      and(eq(accounts.id, transactions.account_id), eq(accounts.user_id, uid)),
    )
    .where(
      and(
        eq(transactions.user_id, uid),
        gte(transactions.data, inicioDaJanela(mes, hoje)),
        lte(transactions.data, fim),
      ),
    )
    .orderBy(asc(transactions.data), asc(transactions.id));
  const cats = await tx.select().from(categories).where(eq(categories.user_id, uid));
  return {
    lancamentos: linhas.map((l) => ({
      ...l,
      conta_tipo: (l.conta_tipo as TipoDeConta | null) ?? null,
    })) as LancamentoDeInsight[],
    categorias: new Map<string, CategoriaDeInsight>(
      cats.map((c) => [
        c.id,
        {
          id: c.id,
          nome: c.nome,
          natureza: c.natureza as "receita" | "despesa",
          tipo_custo: c.tipo_custo as "fixo" | "variavel",
          essencial: c.essencial,
          sistema: c.sistema,
        },
      ]),
    ),
    mes,
    hoje,
    config: await lerConfiguracao(tx, uid),
  };
}

/**
 * Recalcula e grava o cache do mes. No mes corrente, publica no outbox
 * `finance.insight.novo.v1` cada assinatura nova, reajuste e tarifa nova que
 * ainda nao foi anunciada (o Prompt 8 transforma em alerta).
 */
export async function recalcularInsights(
  tx: Tx,
  uid: string,
  mes: string,
  hoje: string,
): Promise<{ linha: LinhaDoCache; eventos: number }> {
  const marca = await marcaDosDados(tx, uid, hoje);
  const ctx = await contextoDoUsuario(tx, uid, mes, hoje);
  const { insights: lista, assinaturas } = gerarInsights(ctx);
  const ja = await tx.execute<{ chave: string }>(sql`
    select distinct unnest(anunciados) as chave from finance.insights where user_id = ${uid}`);
  const anunciados = new Set(ja.rows.map((r) => r.chave));
  let eventos = 0;
  if (mes === hoje.slice(0, 7))
    for (const n of novidades(lista)) {
      if (anunciados.has(n.chave)) continue;
      anunciados.add(n.chave);
      eventos++;
      await tx.insert(outbox).values({
        id: randomUUID(),
        event_name: EVENTO_INSIGHT_NOVO,
        payload: {
          user_id: uid,
          insight_id: n.insight.id,
          motivo: n.motivo,
          chave: n.chave,
          tipo: n.insight.tipo,
          titulo: n.insight.titulo,
          descricao: n.insight.descricao,
          impacto_mensal: n.insight.impacto_mensal,
          impacto_anual: n.insight.impacto_anual,
          periodo: mes,
        },
        occurred_at: new Date().toISOString(),
        producer: "finance",
      });
    }
  const valores = {
    calculado_em: sql`now()`,
    insights: lista,
    assinaturas,
    anunciados: [...anunciados].sort(),
    marca_dos_dados: marca,
  };
  const [linha] = await tx
    .insert(insights)
    .values({ id: randomUUID(), user_id: uid, periodo: mes, ...valores })
    .onConflictDoUpdate({ target: [insights.user_id, insights.periodo], set: valores })
    .returning();
  return { linha: linha!, eventos };
}

/** Cache do mes; recalcula se nao ha, se os lancamentos mudaram ou se e outro dia. */
async function cache(
  tx: Tx,
  uid: string,
  mes: string,
  hoje: string,
): Promise<LinhaDoCache> {
  const [linha] = await tx
    .select()
    .from(insights)
    .where(and(eq(insights.user_id, uid), eq(insights.periodo, mes)));
  if (linha && linha.marca_dos_dados === (await marcaDosDados(tx, uid, hoje)))
    return linha;
  return (await recalcularInsights(tx, uid, mes, hoje)).linha;
}

async function feedbacks(tx: Tx, uid: string): Promise<Feedback[]> {
  return (
    await tx.select().from(insight_feedback).where(eq(insight_feedback.user_id, uid))
  ).map((f) => ({
    insight_id: f.insight_id,
    acao: f.acao as AcaoDeFeedback,
    impacto_anual: f.impacto_anual,
    registrado_em: f.registrado_em,
  }));
}

export interface InsightsDoMes {
  periodo: string;
  calculado_em: string;
  insights: InsightComFeedback[];
  ocultos: number;
  configuracao: Configuracao;
}

export async function listarInsights(
  tx: Tx,
  uid: string,
  mes: string,
  hoje: string,
): Promise<InsightsDoMes> {
  const c = await cache(tx, uid, mes, hoje);
  const { visiveis, ocultos } = aplicarFeedback(
    c.insights as Insight[],
    await feedbacks(tx, uid),
    hoje,
  );
  return {
    periodo: mes,
    calculado_em: new Date(c.calculado_em).toISOString(),
    insights: visiveis,
    ocultos,
    configuracao: await lerConfiguracao(tx, uid),
  };
}

async function acharInsight(tx: Tx, uid: string, id: string, mes: string, hoje: string) {
  const c = await cache(tx, uid, mes, hoje);
  const i = (c.insights as Insight[]).find((x) => x.id === id);
  if (!i) throw new ErroDeFinancas(404, "Insight não encontrado.");
  const f = (await feedbacks(tx, uid)).find((x) => x.insight_id === id);
  return {
    cache: c,
    insight: {
      ...i,
      feedback: f ? { acao: f.acao, registrado_em: f.registrado_em } : null,
    } as InsightComFeedback,
  };
}

/** O insight e os lancamentos que o geraram. */
export async function detalheDoInsight(
  tx: Tx,
  uid: string,
  id: string,
  mes: string,
  hoje: string,
): Promise<DetalheDoInsight> {
  const { insight } = await acharInsight(tx, uid, id, mes, hoje);
  const ids = insight.evidencias;
  const linhas = ids.length
    ? await tx
        .select({
          id: transactions.id,
          data: transactions.data,
          descricao: transactions.descricao,
          valor: transactions.valor,
          tipo: transactions.tipo,
          categoria: categories.nome,
          conta: accounts.nome,
          cartao: cards.nome,
        })
        .from(transactions)
        .leftJoin(
          categories,
          and(eq(categories.id, transactions.category_id), eq(categories.user_id, uid)),
        )
        .leftJoin(
          accounts,
          and(eq(accounts.id, transactions.account_id), eq(accounts.user_id, uid)),
        )
        .leftJoin(cards, and(eq(cards.id, transactions.card_id), eq(cards.user_id, uid)))
        .where(and(eq(transactions.user_id, uid), inArray(transactions.id, ids)))
        .orderBy(sql`${transactions.data} desc`, asc(transactions.id))
    : [];
  return {
    insight,
    evidencias: linhas.map((l): EvidenciaDoInsight => ({
      id: l.id,
      data: l.data,
      descricao: l.descricao,
      valor: l.valor,
      tipo: l.tipo as EvidenciaDoInsight["tipo"],
      categoria: l.categoria,
      origem: l.cartao ?? l.conta,
    })),
  };
}

export async function registrarFeedback(
  tx: Tx,
  uid: string,
  id: string,
  acao: AcaoDeFeedback,
  mes: string,
  hoje: string,
  origem?: Origem,
): Promise<{ insight_id: string; acao: AcaoDeFeedback; registrado_em: string }> {
  const { insight } = await acharInsight(tx, uid, id, mes, hoje);
  const valores = {
    acao,
    tipo: insight.tipo,
    impacto_anual: insight.impacto_anual,
    registrado_em: hoje,
  };
  await tx
    .insert(insight_feedback)
    .values({ id: randomUUID(), user_id: uid, insight_id: id, ...valores })
    .onConflictDoUpdate({
      target: [insight_feedback.user_id, insight_feedback.insight_id],
      set: valores,
    });
  await auditar(tx, uid, `insight.${acao}`, "insight", id, origem, insight.titulo);
  return { insight_id: id, acao, registrado_em: hoje };
}

/**
 * "Transformar em recorrente": cria a recorrencia a partir da proxima cobranca
 * (sem previsto no passado) e marca a assinatura como "ainda uso".
 */
export async function assinaturaParaRecorrencia(
  tx: Tx,
  uid: string,
  id: string,
  hoje: string,
  origem?: Origem,
): Promise<Recorrencia> {
  const c = await cache(tx, uid, hoje.slice(0, 7), hoje);
  const a = (c.assinaturas as Assinatura[]).find((x) => x.id === id);
  if (!a) throw new ErroDeFinancas(404, "Assinatura não encontrada.");
  const nova: NovaRecorrencia = {
    tipo: "despesa",
    descricao: a.nome,
    valor: a.valor_atual,
    category_id: a.category_id,
    ...(a.card_id ? { card_id: a.card_id } : { account_id: a.account_id as string }),
    frequencia: a.frequencia,
    dia: Number(a.ultima.slice(8, 10)),
    inicio: a.proxima,
    fim: null,
    valor_variavel: false,
    ativa: true,
  };
  const r = await criarRecorrencia(tx, uid, nova, hoje, origem);
  await registrarFeedback(tx, uid, id, "ainda_uso", hoje.slice(0, 7), hoje, origem);
  return r;
}

/** Assinaturas detectadas no mes corrente, com a resposta do usuario. */
export async function listarAssinaturas(
  tx: Tx,
  uid: string,
  hoje: string,
): Promise<Omit<ListaDeAssinaturas, "cdi">> {
  const c = await cache(tx, uid, hoje.slice(0, 7), hoje);
  const porId = new Map((await feedbacks(tx, uid)).map((f) => [f.insight_id, f]));
  const lista = (c.assinaturas as Assinatura[]).map((a) => {
    const f = porId.get(a.id);
    return {
      id: a.id,
      nome: a.nome,
      frequencia: a.frequencia,
      valor_atual: a.valor_atual,
      valor_mensal: a.valor_mensal,
      valor_anual: a.valor_anual,
      ocorrencias: a.ocorrencias,
      primeira: a.primeira,
      ultima: a.ultima,
      proxima: a.proxima,
      categoria: a.categoria,
      grupo: a.grupo,
      reajuste: a.reajuste,
      duplicidade: a.duplicidade,
      nova: a.nova,
      feedback: f ? { acao: f.acao, registrado_em: f.registrado_em } : null,
    };
  });
  // "Ja cancelei" sem cobranca depois sai do total.
  const ativas = lista.filter(
    (a) => !(a.feedback?.acao === "ja_cancelei" && a.ultima <= a.feedback.registrado_em),
  );
  const mensal = ativas.reduce((s, a) => s.plus(a.valor_mensal), d(0));
  return {
    assinaturas: lista,
    total_mensal: moeda(mensal),
    total_anual: moeda(ativas.reduce((s, a) => s.plus(a.valor_anual), d(0))),
  };
}

/** O que o simulador oferece: assinaturas, categorias, formiga, fluxo e metas. */
export async function baseDoSimulador(
  tx: Tx,
  uid: string,
  hoje: string,
  cdi: TaxaCdi | null,
  carteira?: ValorDaCarteira,
): Promise<BaseDoSimulador> {
  const mes = hoje.slice(0, 7);
  const assinaturas = await listarAssinaturas(tx, uid, hoje);
  const c = await cache(tx, uid, mes, hoje);
  const formiga = (c.insights as Insight[]).find((i) => i.tipo === "formiga");
  // Media dos 3 meses completos anteriores, por categoria de despesa.
  const medias = await tx
    .select({
      category_id: categories.id,
      nome: categories.nome,
      media: sql<string>`(sum(${transactions.valor}) / 3)::numeric(18,2)::text`,
    })
    .from(transactions)
    .innerJoin(
      categories,
      and(eq(categories.id, transactions.category_id), eq(categories.user_id, uid)),
    )
    .where(
      and(
        eq(transactions.user_id, uid),
        eq(transactions.tipo, "despesa"),
        sql`${transactions.status} <> 'previsto'`,
        gte(transactions.competencia, inicioDoMes(mes, -3)),
        lte(transactions.competencia, inicioDoMes(mes, -1)),
      ),
    )
    .groupBy(categories.id, categories.nome)
    .orderBy(sql`sum(${transactions.valor}) desc`);
  const metas = (await listarMetas(tx, uid, hoje, carteira)).filter((m) => m.ativa);
  return {
    assinaturas: assinaturas.assinaturas
      .filter((a) => a.feedback?.acao !== "ja_cancelei")
      .map((a) => ({ id: a.id, nome: a.nome, valor_mensal: a.valor_mensal })),
    categorias: medias.map((m) => ({
      category_id: m.category_id,
      nome: m.nome,
      media_mensal: m.media,
    })),
    formiga: formiga ? { mensal: formiga.impacto_mensal } : null,
    fluxo: await fluxoDeCaixa(tx, uid, hoje, 12),
    metas: metas.map((m) => {
      const falta = d(m.valor_alvo).minus(m.valor_atual);
      return {
        id: m.id,
        nome: m.nome,
        falta: moeda(falta.gt(0) ? falta : d(0)),
        valor_mensal_necessario: m.valor_mensal_necessario,
      };
    }),
    cdi,
  };
}

/**
 * Job `finance.insights` (pg-boss no portfolio-worker): recalcula o mes
 * corrente de um usuario (apos importacao confirmada) ou de todos (diario).
 * Cada usuario na propria transacao, pela RLS.
 */
export async function rotinaDeInsights<S extends Record<string, unknown>>(
  db: NodePgDatabase<S>,
  hoje: string,
  userId?: string,
): Promise<{ usuarios: number; eventos: number }> {
  // Lista os donos como superusuario: so os ids, nenhum dado do usuario.
  const usuarios = userId
    ? [userId]
    : (
        await db.execute<{ user_id: string }>(
          sql`select distinct user_id from finance.transactions`,
        )
      ).rows.map((r) => r.user_id);
  let eventos = 0;
  for (const u of usuarios)
    eventos += (
      await comoUsuario(db, u, (tx) => recalcularInsights(tx, u, hoje.slice(0, 7), hoje))
    ).eventos;
  return { usuarios: usuarios.length, eventos };
}
