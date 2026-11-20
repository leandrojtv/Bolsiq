import "server-only";
import PgBoss from "pg-boss";
import { env } from "./env";

let cliente: Promise<PgBoss> | null = null;
const filas = new Map<string, Promise<unknown>>();

/** Cliente do pg-boss so para enfileirar: quem trabalha e o portfolio-worker. */
function boss(): Promise<PgBoss> {
  cliente ??= (async () => {
    const b = new PgBoss({
      connectionString: env.DATABASE_URL,
      schema: "pgboss",
      supervise: false,
      schedule: false,
    });
    b.on("error", (e) =>
      process.stderr.write(
        `${JSON.stringify({ level: "error", modulo: "fila", msg: String(e) })}\n`,
      ),
    );
    await b.start();
    return b;
  })();
  return cliente;
}

/** Cria a fila na primeira vez (as opcoes iguais as do worker) e envia o job. */
export async function enfileirar(
  fila: string,
  dados: object,
  opcoes: Omit<PgBoss.Queue, "name"> = {},
  envio: PgBoss.SendOptions = {},
): Promise<void> {
  const b = await boss();
  let criada = filas.get(fila);
  if (!criada) {
    criada = b.createQueue(fila, { name: fila, ...opcoes });
    filas.set(fila, criada);
  }
  await criada;
  await b.send(fila, dados, envio);
}
