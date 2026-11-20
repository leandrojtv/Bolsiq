import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { fecharFaturas } from "./cartoes.js";
import { gerarPrevistos } from "./recorrencias.js";
import { comoUsuario } from "./sessao.js";

export const JOB_ROTINA_DIARIA = "finance.rotina-diaria";

export interface ResultadoDaRotina {
  usuarios: number;
  previstos: number;
  faturas_fechadas: number;
}

/**
 * Rotina diaria do Bolsiq Financas (pg-boss no portfolio-worker): gera os
 * previstos das recorrencias ate 90 dias e fecha as faturas vencidas. Cada
 * usuario numa transacao propria, pela RLS. Rodar duas vezes nao duplica.
 */
export async function rotinaDiaria<S extends Record<string, unknown>>(
  db: NodePgDatabase<S>,
  hoje: string,
): Promise<ResultadoDaRotina> {
  // Lista os donos como superusuario: so os ids, nenhum dado do usuario.
  const r = await db.execute<{ user_id: string }>(sql`
    select user_id from finance.recurrences where ativa
    union
    select user_id from finance.statements where status <> 'paga'`);
  const resultado: ResultadoDaRotina = { usuarios: 0, previstos: 0, faturas_fechadas: 0 };
  for (const { user_id } of r.rows) {
    const [previstos, fechadas] = await comoUsuario(db, user_id, async (tx) => [
      await gerarPrevistos(tx, user_id, hoje),
      await fecharFaturas(tx, user_id, hoje),
    ]);
    resultado.usuarios++;
    resultado.previstos += previstos;
    resultado.faturas_fechadas += fechadas;
  }
  return resultado;
}
