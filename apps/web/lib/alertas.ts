import "server-only";
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Regra, schema } from "@bolsiq/alerts";
import { banco } from "./analytics";
import {
  descreverCondicao,
  paramsDaRegra,
  type CanalDeAlerta,
  type NotificacaoNaTela,
  type NovaRegra,
  type Preferencias,
  type RegraNaTela,
  type TipoDeRegra,
} from "./alertas-modelo";
import { env } from "./env";
import { buscarV1, VALIDADE } from "./market-data";

const { alertRules, notifications, userPrefs, pushSubscriptions } = schema;

/**
 * Alertas sao modulo do app (CLAUDE.md): o BFF le e grava o schema `alerts`
 * direto. O alerts-worker recarrega as regras a cada 2 s pelo `atualizado_em`,
 * entao toda escrita aqui atualiza esse campo.
 */

export class ErroDeAlerta extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export function telegramHabilitadoNoApp(): boolean {
  return env.FEATURE_TELEGRAM === "true";
}

export async function listarRegras(uid: string): Promise<RegraNaTela[]> {
  const linhas = await banco()
    .select()
    .from(alertRules)
    .where(eq(alertRules.user_id, uid))
    .orderBy(desc(alertRules.criado_em));
  return linhas.map((l) => ({
    id: l.id,
    ticker: l.ticker ?? "",
    tipo: l.tipo as TipoDeRegra,
    condicao: descreverCondicao(
      l.tipo as TipoDeRegra,
      (l.params ?? {}) as Record<string, unknown>,
    ),
    canais: l.canais as CanalDeAlerta[],
    ativo: l.ativo,
    ultimo_disparo_em: l.ultimo_disparo_em,
  }));
}

const SILENCIO = { nenhum: [null, null], "22-7": ["22:00", "07:00"] } as const;

export async function criarRegra(uid: string, r: NovaRegra): Promise<RegraNaTela> {
  const ativo = await buscarV1(`assets/${r.ticker}`, VALIDADE.assets);
  if (ativo.status === 404)
    throw new ErroDeAlerta(422, `${r.ticker} não está no universo da B3`);
  if (r.canais.includes("telegram") && !telegramHabilitadoNoApp()) {
    throw new ErroDeAlerta(422, "Telegram não está habilitado");
  }

  const db = banco();
  const [prefs] = await db.select().from(userPrefs).where(eq(userPrefs.user_id, uid));
  const email = r.email ?? prefs?.email ?? null;
  if (r.canais.includes("email") && !email)
    throw new ErroDeAlerta(422, "Informe o e-mail para o canal e-mail");

  const regra = Regra.parse({
    id: randomUUID(),
    user_id: uid,
    tipo: r.tipo,
    ticker: r.ticker,
    params: paramsDaRegra(r),
    canais: r.canais,
    cooldown_segundos: r.cooldown_segundos,
  });
  const [inicio, fim] = SILENCIO[r.silencio];

  await db.transaction(async (tx) => {
    await tx.insert(alertRules).values({
      id: regra.id,
      user_id: uid,
      tipo: regra.tipo,
      ticker: regra.ticker,
      params: regra.params,
      canais: regra.canais,
      cooldown_segundos: regra.cooldown_segundos,
    });
    // Marcar um canal na regra liga o canal nas preferencias: o motor so
    // entrega por canal habilitado. Desligar em /configuracoes/notificacoes
    // continua valendo para todas as regras.
    const habilitados = [
      ...new Set([...(prefs?.canais_habilitados ?? ["inapp"]), ...r.canais]),
    ];
    await tx
      .insert(userPrefs)
      .values({
        user_id: uid,
        email,
        canais_habilitados: habilitados,
        silencio_inicio: inicio,
        silencio_fim: fim,
      })
      .onConflictDoUpdate({
        target: userPrefs.user_id,
        set: {
          email,
          canais_habilitados: habilitados,
          silencio_inicio: inicio,
          silencio_fim: fim,
          atualizado_em: sql`now()`,
        },
      });
  });

  const [criada] = (await listarRegras(uid)).filter((x) => x.id === regra.id);
  return criada as RegraNaTela;
}

export async function alterarRegra(
  uid: string,
  id: string,
  ativo: boolean,
): Promise<void> {
  const r = await banco()
    .update(alertRules)
    .set({ ativo, atualizado_em: sql`now()` })
    .where(and(eq(alertRules.id, id), eq(alertRules.user_id, uid)))
    .returning({ id: alertRules.id });
  if (r.length === 0) throw new ErroDeAlerta(404, "Regra não encontrada");
}

export async function removerRegra(uid: string, id: string): Promise<void> {
  // Desligar antes de apagar: o worker so tira do indice o que ve mudar.
  await alterarRegra(uid, id, false);
  await banco()
    .delete(alertRules)
    .where(and(eq(alertRules.id, id), eq(alertRules.user_id, uid)));
}

export async function listarNotificacoes(
  uid: string,
  soNaoLidas: boolean,
): Promise<{ itens: NotificacaoNaTela[]; nao_lidas: number }> {
  const db = banco();
  const condicao = soNaoLidas
    ? and(eq(notifications.user_id, uid), isNull(notifications.lida_em))
    : eq(notifications.user_id, uid);
  const [linhas, [total]] = await Promise.all([
    db
      .select({
        id: notifications.id,
        titulo: notifications.titulo,
        corpo: notifications.corpo,
        dados: notifications.dados,
        criada_em: notifications.criada_em,
        lida_em: notifications.lida_em,
        tipo: alertRules.tipo,
        ticker: alertRules.ticker,
      })
      .from(notifications)
      .leftJoin(alertRules, eq(alertRules.id, notifications.rule_id))
      .where(condicao)
      .orderBy(desc(notifications.criada_em))
      .limit(50),
    naoLidasDe(uid).then((n) => [n]),
  ]);
  return {
    itens: linhas.map((l) => {
      const dados = (l.dados ?? {}) as { ticker?: string; tipo?: string };
      return {
        id: l.id,
        titulo: l.titulo,
        corpo: l.corpo,
        ticker: l.ticker ?? dados.ticker ?? null,
        tipo: (l.tipo ?? dados.tipo ?? null) as TipoDeRegra | null,
        criada_em: new Date(l.criada_em).toISOString(),
        lida: l.lida_em !== null,
      };
    }),
    nao_lidas: total ?? 0,
  };
}

export async function naoLidasDe(uid: string): Promise<number> {
  const [r] = await banco()
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.user_id, uid), isNull(notifications.lida_em)));
  return r?.n ?? 0;
}

export async function marcarLidas(uid: string, ids: string[] | null): Promise<void> {
  await banco()
    .update(notifications)
    .set({ lida_em: sql`now()` })
    .where(
      and(
        eq(notifications.user_id, uid),
        isNull(notifications.lida_em),
        ...(ids ? [inArray(notifications.id, ids)] : []),
      ),
    );
}

export async function lerPreferencias(uid: string): Promise<Preferencias> {
  const [p] = await banco().select().from(userPrefs).where(eq(userPrefs.user_id, uid));
  return {
    email: p?.email ?? null,
    canais_habilitados: (p?.canais_habilitados as CanalDeAlerta[] | undefined) ?? [
      "inapp",
    ],
    silencio_inicio: p?.silencio_inicio ?? null,
    silencio_fim: p?.silencio_fim ?? null,
    fuso: p?.fuso ?? "America/Sao_Paulo",
  };
}

export async function salvarPreferencias(uid: string, p: Preferencias): Promise<void> {
  if (p.canais_habilitados.includes("email") && !p.email) {
    throw new ErroDeAlerta(422, "Informe o e-mail para o canal e-mail");
  }
  // "inapp" sempre: a central de notificacoes e o registro de tudo.
  const canais = [...new Set(["inapp" as const, ...p.canais_habilitados])];
  const valores = { ...p, canais_habilitados: canais };
  await banco()
    .insert(userPrefs)
    .values({ user_id: uid, ...valores })
    .onConflictDoUpdate({
      target: userPrefs.user_id,
      set: { ...valores, atualizado_em: sql`now()` },
    });
}

export async function inscreverPush(
  uid: string,
  s: { endpoint: string; keys: { p256dh: string; auth: string } },
): Promise<void> {
  await banco()
    .insert(pushSubscriptions)
    .values({
      user_id: uid,
      endpoint: s.endpoint,
      p256dh: s.keys.p256dh,
      auth: s.keys.auth,
    })
    .onConflictDoUpdate({
      target: [pushSubscriptions.user_id, pushSubscriptions.endpoint],
      set: { p256dh: s.keys.p256dh, auth: s.keys.auth },
    });
}

export async function removerPush(uid: string, endpoint: string): Promise<void> {
  await banco()
    .delete(pushSubscriptions)
    .where(
      and(eq(pushSubscriptions.user_id, uid), eq(pushSubscriptions.endpoint, endpoint)),
    );
}
