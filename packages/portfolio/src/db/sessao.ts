import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

type Tx<S extends Record<string, unknown>> = Parameters<
  Parameters<NodePgDatabase<S>["transaction"]>[0]
>[0];
export type TransacaoDoUsuario<S extends Record<string, unknown>> = Tx<S>;

/**
 * Unico caminho da aplicacao ao schema `portfolio` (ADR 0011).
 *
 * Dentro da transacao: `SET LOCAL ROLE bolsiq_app` tira o superusuario e o
 * dono das tabelas do caminho (sem isso a RLS nao vale), e
 * `set_config(..., true)` e o `SET LOCAL` do usuario: morre no fim da
 * transacao e nao vaza para a proxima requisicao que pegar a conexao.
 *
 * A conexao precisa poder assumir o papel: superusuario ou membro de
 * `bolsiq_app` (`GRANT bolsiq_app TO <login>`).
 */
export async function comoUsuario<S extends Record<string, unknown>, T>(
  db: NodePgDatabase<S>,
  userId: string,
  fn: (tx: Tx<S>) => Promise<T>,
): Promise<T> {
  if (!userId) throw new Error("comoUsuario sem usuario");
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role bolsiq_app`);
    await tx.execute(sql`select set_config('bolsiq.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
