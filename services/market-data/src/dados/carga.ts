import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { fetchLog, type Db } from "@bolsiq/db-core";

export interface Carga {
  id: string;
  /** Mesmo arquivo (hash igual) ja carregado com sucesso: nada a fazer. */
  jaCarregado: boolean;
  /**
   * Carga anterior deste mesmo arquivo comecou e nao terminou. Quem carrega
   * deve emitir eventos para tudo o que esta no arquivo, e nao so para o que
   * mudou: a mudanca pode ter sido gravada pela tentativa que caiu, junto com
   * a perda dos eventos.
   */
  recuperacao: boolean;
  inicio: number;
}

/**
 * Abre o registro de carga no `fetch_log`.
 *
 * Primeiro nivel de idempotencia: hash igual a uma carga `ok`, nao reprocessa.
 * O segundo nivel e a chave natural de cada tabela.
 */
export async function abrirCarga(
  db: Db,
  arquivo: { source: string; sourceRef: string; sha256: string; bytes: number },
): Promise<Carga> {
  const [existente] = await db
    .select({ id: fetchLog.id, status: fetchLog.status })
    .from(fetchLog)
    .where(
      and(
        eq(fetchLog.source, arquivo.source),
        eq(fetchLog.sourceRef, arquivo.sourceRef),
        eq(fetchLog.contentHash, arquivo.sha256),
      ),
    );

  if (existente?.status === "ok") {
    return {
      id: existente.id,
      jaCarregado: true,
      recuperacao: false,
      inicio: Date.now(),
    };
  }

  if (existente) {
    await db
      .update(fetchLog)
      .set({ status: "processando", attempts: sql`${fetchLog.attempts} + 1` })
      .where(eq(fetchLog.id, existente.id));
    return {
      id: existente.id,
      jaCarregado: false,
      recuperacao: true,
      inicio: Date.now(),
    };
  }

  const id = randomUUID();
  await db.insert(fetchLog).values({
    id,
    source: arquivo.source,
    sourceRef: arquivo.sourceRef,
    contentHash: arquivo.sha256,
    bytes: BigInt(arquivo.bytes),
    status: "processando",
    fetchedAt: new Date().toISOString(),
  });
  return { id, jaCarregado: false, recuperacao: false, inicio: Date.now() };
}

type Executor = Pick<Db, "update">;

export async function concluirCarga(
  db: Executor,
  carga: Carga,
  linhas: number,
): Promise<void> {
  await db
    .update(fetchLog)
    .set({ status: "ok", rowsWritten: linhas, durationMs: Date.now() - carga.inicio })
    .where(eq(fetchLog.id, carga.id));
}

export async function falharCarga(db: Db, carga: Carga, erro: unknown): Promise<void> {
  await db
    .update(fetchLog)
    .set({
      status: "falhou",
      errorMessage: erro instanceof Error ? erro.message : String(erro),
      durationMs: Date.now() - carga.inicio,
    })
    .where(eq(fetchLog.id, carga.id));
}
