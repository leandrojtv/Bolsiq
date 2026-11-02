import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

export type Db = ReturnType<typeof criarDb>;

export interface DbOptions {
  url: string;
  maxConnections?: number;
  /**
   * Chamado quando o pool emite erro por conta de um cliente ocioso.
   *
   * Opcional: o padrão escreve uma linha JSON em stderr, no mesmo formato dos
   * logs do pino.
   */
  onError?: (erro: Error) => void;
}

export function criarPool(options: DbOptions): Pool {
  const pool = new Pool({
    connectionString: options.url,
    max: options.maxConnections ?? 10,
    application_name: "bolsiq-market-data",
  });

  // O pg emite `error` em nome de clientes OCIOSOS — por exemplo quando o
  // Postgres cai ou derruba a conexão. Sem listener, o Node trata como evento
  // 'error' não tratado e **encerra o processo**.
  //
  // Verificado na prática: parar o Postgres com o serviço no ar matava o
  // container com exit 1, em vez de deixar o health devolver 503. Ou seja, a
  // queda do banco virava queda do serviço.
  pool.on("error", (erro: Error) => {
    if (options.onError) {
      options.onError(erro);
      return;
    }
    process.stderr.write(
      `${JSON.stringify({
        level: "error",
        msg: "erro em cliente ocioso do pool",
        err: erro.message,
      })}\n`,
    );
  });

  return pool;
}

export function criarDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export { schema };
