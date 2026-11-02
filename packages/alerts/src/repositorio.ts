import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@bolsiq/db-core";
import type { Tx } from "@bolsiq/messaging";
import {
  alertRules,
  deliveries,
  notifications,
  pushSubscriptions,
  userPrefs,
} from "./db/schema.js";
import { Regra, type Canal } from "./regras.js";
import type { Disparo } from "./avaliador.js";
import type { CanalDeEnvio, Destino } from "./canais/canal.js";
import { fimDoSilencio } from "./silencio.js";

const TIPOS_DE_CRUZAMENTO = new Set(["preco_acima", "preco_abaixo"]);
const MAX_TENTATIVAS = 5;

export async function carregarRegras(
  db: Db,
  desde?: string,
): Promise<{ regras: Regra[]; invalidas: string[]; ate: string | null }> {
  const linhas = await db
    .select()
    .from(alertRules)
    .where(desde ? gt(alertRules.atualizado_em, desde) : undefined)
    .orderBy(asc(alertRules.atualizado_em));

  const regras: Regra[] = [];
  const invalidas: string[] = [];
  for (const l of linhas) {
    const r = Regra.safeParse({ ...l, ticker: l.ticker ?? undefined });
    if (r.success) regras.push(r.data);
    else invalidas.push(l.id);
  }
  return { regras, invalidas, ate: linhas.at(-1)?.atualizado_em ?? desde ?? null };
}

/**
 * Grava os disparos na transacao do consumidor.
 *
 * Notificacao, entregas e estado da regra entram juntos com a marca de
 * `processed_events` (que o `assinar` grava na mesma transacao). Reiniciar o
 * worker em qualquer ponto deixa ou tudo ou nada -- e o indice unico
 * (rule_id, event_id) cobre a reentrega que passar da janela de deduplicacao.
 */
export async function registrarDisparos(
  tx: Tx,
  disparos: Disparo[],
  eventId: string,
  agora: Date,
): Promise<string[]> {
  const criadas: string[] = [];
  if (disparos.length === 0) return criadas;

  const usuarios = [...new Set(disparos.map((d) => d.regra.user_id))];
  const prefs = await tx
    .select()
    .from(userPrefs)
    .where(inArray(userPrefs.user_id, usuarios));
  const prefDe = new Map(prefs.map((p) => [p.user_id, p]));

  for (const d of disparos) {
    const inserida = await tx
      .insert(notifications)
      .values({
        id: randomUUID(),
        user_id: d.regra.user_id,
        rule_id: d.regra.id,
        event_id: eventId,
        titulo: d.titulo,
        corpo: d.corpo,
        dados: d.dados,
      })
      .onConflictDoNothing({ target: [notifications.rule_id, notifications.event_id] })
      .returning({ id: notifications.id });

    const id = inserida[0]?.id;
    if (id === undefined) continue;
    criadas.push(id);

    const p = prefDe.get(d.regra.user_id);
    const habilitados = new Set<Canal>(
      (p?.canais_habilitados as Canal[] | undefined) ?? ["inapp"],
    );
    const fim = p
      ? fimDoSilencio(agora, p.silencio_inicio, p.silencio_fim, p.fuso)
      : null;

    const canais = d.regra.canais.filter((c) => c === "inapp" || habilitados.has(c));
    await tx.insert(deliveries).values(
      canais.map((c) => ({
        id: randomUUID(),
        notification_id: id,
        user_id: d.regra.user_id,
        canal: c,
        agendada_para: (c !== "inapp" && fim ? fim : agora).toISOString(),
      })),
    );

    await tx
      .update(alertRules)
      .set({
        ultimo_disparo_em: agora.toISOString(),
        ...(TIPOS_DE_CRUZAMENTO.has(d.regra.tipo) ? { armado: false } : {}),
      })
      .where(eq(alertRules.id, d.regra.id));
  }

  return criadas;
}

export async function rearmar(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.update(alertRules).set({ armado: true }).where(inArray(alertRules.id, ids));
}

/**
 * Envia as entregas pendentes.
 *
 * `FOR UPDATE SKIP LOCKED`: dois workers nao pegam a mesma entrega. A garantia
 * para canal externo e at-least-once: se o processo cair entre o envio e a
 * marca de enviada, o e-mail sai de novo. Exactly-once com SMTP nao existe.
 */
export async function processarEntregas(
  db: Db,
  canais: Map<Canal, CanalDeEnvio>,
  agora: Date,
  lote = 100,
): Promise<{ enviadas: number; falhas: number }> {
  let enviadas = 0;
  let falhas = 0;

  await db.transaction(async (tx) => {
    // Trava so `deliveries`, sem join: `FOR UPDATE OF` exige nome de tabela
    // nao qualificado no Postgres, e o Drizzle emite "alerts"."deliveries" --
    // a consulta com join falhava em toda rodada.
    const travadas = await tx
      .select()
      .from(deliveries)
      .where(
        and(
          eq(deliveries.status, "pendente"),
          lte(deliveries.agendada_para, agora.toISOString()),
        ),
      )
      .orderBy(asc(deliveries.agendada_para))
      .limit(lote)
      .for("update", { skipLocked: true });

    if (travadas.length === 0) return;

    const notas = await tx
      .select()
      .from(notifications)
      .where(
        inArray(notifications.id, [...new Set(travadas.map((d) => d.notification_id))]),
      );
    const notaDe = new Map(notas.map((n) => [n.id, n]));

    const pendentes = travadas.flatMap((d) => {
      const n = notaDe.get(d.notification_id);
      return n ? [{ ...d, titulo: n.titulo, corpo: n.corpo, dados: n.dados }] : [];
    });

    for (const e of pendentes) {
      const canal = canais.get(e.canal as Canal);
      if (!canal) {
        await marcar(
          tx,
          e.id,
          "descartada",
          e.tentativas,
          `canal ${e.canal} nao registrado`,
        );
        falhas++;
        continue;
      }

      const destino = await destinoDe(tx, e.user_id);
      const r = await canal.enviar(
        {
          id: e.notification_id,
          user_id: e.user_id,
          titulo: e.titulo,
          corpo: e.corpo,
          dados: e.dados,
        },
        destino,
      );

      if (r.ok) {
        await tx
          .update(deliveries)
          .set({ status: "enviada", enviada_em: agora.toISOString(), erro: null })
          .where(eq(deliveries.id, e.id));
        enviadas++;
        continue;
      }

      if (r.remover_push?.length) {
        await tx
          .delete(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.user_id, e.user_id),
              inArray(pushSubscriptions.endpoint, r.remover_push),
            ),
          );
      }

      const tentativas = e.tentativas + 1;
      const status = r.definitivo || tentativas >= MAX_TENTATIVAS ? "falhou" : "pendente";
      // Backoff exponencial: a proxima tentativa fica agendada, nao imediata.
      const proxima = new Date(agora.getTime() + 2 ** tentativas * 1000).toISOString();
      await tx
        .update(deliveries)
        .set({ status, tentativas, erro: r.erro, agendada_para: proxima })
        .where(eq(deliveries.id, e.id));
      falhas++;
    }
  });

  return { enviadas, falhas };
}

async function marcar(
  tx: Tx,
  id: string,
  status: string,
  tentativas: number,
  erro: string,
) {
  await tx
    .update(deliveries)
    .set({ status, tentativas, erro })
    .where(eq(deliveries.id, id));
}

async function destinoDe(tx: Tx, userId: string): Promise<Destino> {
  const [p] = await tx.select().from(userPrefs).where(eq(userPrefs.user_id, userId));
  const push = await tx
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.user_id, userId));
  return { email: p?.email ?? null, telegram_chat_id: p?.telegram_chat_id ?? null, push };
}

/** Contagem do sino: nao lidas do usuario. */
export async function naoLidas(db: Db, userId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.user_id, userId), sql`${notifications.lida_em} IS NULL`));
  return r?.n ?? 0;
}
