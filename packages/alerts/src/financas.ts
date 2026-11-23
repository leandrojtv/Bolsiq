import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Tx } from "@bolsiq/messaging";
import { deliveries, notifications, userPrefs } from "./db/schema.js";
import type { Canal } from "./regras.js";
import { fimDoSilencio } from "./silencio.js";
import { preferenciasCompletas, type AvisoFinanceiro } from "./financas-modelo.js";

export * from "./financas-modelo.js";

/**
 * Grava o aviso na transacao do consumidor: notificacao (unica por
 * `financas:<tipo>` e `<usuario>:<chave>`) e uma entrega por canal ligado no
 * tipo e nas preferencias gerais, com a janela de silencio nos externos.
 */
export async function registrarAvisoFinanceiro(
  tx: Tx,
  a: AvisoFinanceiro,
  agora: Date,
): Promise<string | null> {
  const [p] = await tx.select().from(userPrefs).where(eq(userPrefs.user_id, a.user_id));
  const pref = preferenciasCompletas(p?.financas)[a.tipo];
  if (!pref.ativo) return null;

  const [n] = await tx
    .insert(notifications)
    .values({
      id: randomUUID(),
      user_id: a.user_id,
      rule_id: `financas:${a.tipo}`,
      event_id: `${a.user_id}:${a.chave}`,
      titulo: a.titulo,
      corpo: a.corpo,
      dados: { tipo: a.tipo, link: a.link },
    })
    .onConflictDoNothing({ target: [notifications.rule_id, notifications.event_id] })
    .returning({ id: notifications.id });
  if (!n) return null;

  const habilitados = new Set<Canal>(
    (p?.canais_habilitados as Canal[] | undefined) ?? [],
  );
  const fim = p ? fimDoSilencio(agora, p.silencio_inicio, p.silencio_fim, p.fuso) : null;
  const canais = [
    "inapp" as const,
    ...pref.canais.filter((c) => c !== "inapp" && habilitados.has(c)),
  ];
  await tx.insert(deliveries).values(
    canais.map((c) => ({
      id: randomUUID(),
      notification_id: n.id,
      user_id: a.user_id,
      canal: c,
      agendada_para: (c !== "inapp" && fim ? fim : agora).toISOString(),
    })),
  );
  return n.id;
}
