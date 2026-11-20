import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { validarPayload } from "@bolsiq/contracts";
import { somarDias } from "../recorrencia.js";
import {
  faturasVencendo,
  limitesDoOrcamento,
  receitasAtrasadas,
  saldoNegativo,
  MESES_DO_FLUXO_VIGIADO,
  type Fato,
} from "../vigia.js";
import { fluxoDeCaixa } from "./fluxo.js";
import type { Tx } from "./operacoes.js";
import { comoUsuario } from "./sessao.js";
import { faturasAPagar } from "./patrimonio.js";
import { obterPlanejamento } from "./planejamento.js";
import { emitted_alerts, outbox, transactions } from "./schema.js";

export const JOB_VIGIA = "finance.vigia";

/** Receita prevista mais velha que isto nao vira alerta: e cadastro esquecido. */
const JANELA_DA_RECEITA_DIAS = 31;

/** Os fatos de agora, pelas regras de `vigia.ts`. */
export async function fatosDoUsuario(tx: Tx, uid: string, hoje: string): Promise<Fato[]> {
  const mes = hoje.slice(0, 7);
  const [faturas, plano, fluxo, previstas] = await Promise.all([
    faturasAPagar(tx, uid),
    obterPlanejamento(tx, uid, mes),
    fluxoDeCaixa(tx, uid, hoje, MESES_DO_FLUXO_VIGIADO),
    tx
      .select({
        id: transactions.id,
        descricao: transactions.descricao,
        valor: transactions.valor,
        data: transactions.data,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.user_id, uid),
          eq(transactions.tipo, "receita"),
          eq(transactions.status, "previsto"),
          lt(transactions.data, hoje),
          gte(transactions.data, somarDias(hoje, -JANELA_DA_RECEITA_DIAS)),
          sql`${transactions.account_id} is not null`,
        ),
      )
      .orderBy(asc(transactions.data)),
  ]);
  return [
    ...faturasVencendo(faturas, hoje),
    ...limitesDoOrcamento(plano.categorias, mes),
    ...saldoNegativo(fluxo.meses),
    ...receitasAtrasadas(previstas, hoje),
  ];
}

/**
 * Publica no outbox os fatos ainda nao avisados. Roda dentro de `comoUsuario`:
 * `emitted_alerts` e o outbox ficam na mesma transacao, entao o fato so conta
 * como avisado se o evento foi gravado.
 */
export async function vigiarUsuario(
  tx: Tx,
  uid: string,
  hoje: string,
): Promise<{ fatos: number; publicados: number }> {
  const fatos = await fatosDoUsuario(tx, uid, hoje);
  let publicados = 0;
  for (const f of fatos) {
    const payload = { user_id: uid, ...f.payload };
    const v = validarPayload(f.evento, payload);
    if (!v.ok) throw new Error(`evento rejeitado antes do outbox: ${v.erro}`);
    const novo = await tx
      .insert(emitted_alerts)
      .values({ user_id: uid, chave: f.chave, event_name: f.evento })
      .onConflictDoNothing()
      .returning({ chave: emitted_alerts.chave });
    if (!novo.length) continue;
    await tx.insert(outbox).values({
      id: randomUUID(),
      event_name: f.evento,
      payload: v.payload,
      occurred_at: new Date().toISOString(),
      producer: "finance",
    });
    publicados++;
  }
  return { fatos: fatos.length, publicados };
}

/**
 * Job `finance.vigia` (pg-boss no portfolio-worker): um usuario (apos
 * importacao ou lancamento) ou todos com conta ou cartao (de hora em hora).
 * Cada usuario na propria transacao, pela RLS; a lista de ids e a unica
 * consulta como dono das tabelas.
 */
export async function rotinaDoVigia<S extends Record<string, unknown>>(
  db: NodePgDatabase<S>,
  hoje: string,
  userId?: string,
): Promise<{ usuarios: number; publicados: number }> {
  const usuarios = userId
    ? [userId]
    : (
        await db.execute<{ user_id: string }>(sql`
          select user_id from finance.accounts where not arquivada
          union
          select user_id from finance.cards where not arquivado`)
      ).rows.map((r) => r.user_id);
  let publicados = 0;
  for (const u of usuarios)
    publicados += (await comoUsuario(db, u, (tx) => vigiarUsuario(tx, u, hoje)))
      .publicados;
  return { usuarios: usuarios.length, publicados };
}
