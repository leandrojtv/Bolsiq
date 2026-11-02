import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import { validarPayload } from "@bolsiq/contracts";
import { deadLetter, outbox, type Db } from "@bolsiq/db-core";
import { envelopeDaLinha, type Publicador, type ResultadoPublicacao } from "./outbox.js";
import { MAX_ENTREGAS } from "./stream.js";

export interface PublicarPendentesDeps {
  db: Db;
  publicador: Publicador;
  /** Quantas linhas por rodada. */
  lote?: number;
  /** Tentativas antes de mandar para a dead-letter. */
  maxTentativas?: number;
}

/**
 * Publica o que está pendente no outbox.
 *
 * Chamado pelo job `outbox-publish` do pg-boss. É a metade "at-least-once" da
 * garantia: a linha só sai de pendente depois do ack do broker, então falha de
 * rede ou NATS fora do ar resultam em republicação, nunca em perda.
 *
 * `FOR UPDATE SKIP LOCKED` permite mais de um publisher ao mesmo tempo sem
 * que dois peguem a mesma linha — e sem que um fique esperando o outro.
 */
export async function publicarPendentes(
  deps: PublicarPendentesDeps,
): Promise<ResultadoPublicacao> {
  const lote = deps.lote ?? 200;
  const maxTentativas = deps.maxTentativas ?? MAX_ENTREGAS;

  const resultado: ResultadoPublicacao = {
    publicados: 0,
    duplicados: 0,
    falhas: 0,
    mortos: 0,
  };

  const pendentes = await deps.db
    .select()
    .from(outbox)
    .where(and(isNull(outbox.publishedAt), isNull(outbox.deadAt)))
    .orderBy(asc(outbox.createdAt))
    .limit(lote)
    .for("update", { skipLocked: true });

  for (const linha of pendentes) {
    // Revalidação antes de publicar. A linha pode ter sido escrita por uma
    // versão anterior do serviço, com um schema que já mudou.
    const validacao = validarPayload(linha.eventName, linha.payload);
    if (!validacao.ok) {
      await enterrar(deps.db, linha, validacao.erro, "outbox-publisher");
      resultado.mortos += 1;
      continue;
    }

    try {
      const ack = await deps.publicador.publicar(envelopeDaLinha(linha));

      await deps.db
        .update(outbox)
        .set({ publishedAt: new Date().toISOString(), lastError: null })
        .where(eq(outbox.id, linha.id));

      if (ack.duplicate) {
        // O broker reconheceu o Nats-Msg-Id: a mensagem já estava lá. Marcar
        // como publicada é o correto — a entrega aconteceu, só não agora.
        resultado.duplicados += 1;
      } else {
        resultado.publicados += 1;
      }
    } catch (erro) {
      const tentativas = linha.attempts + 1;
      const mensagem = erro instanceof Error ? erro.message : String(erro);

      if (tentativas >= maxTentativas) {
        await enterrar(deps.db, linha, mensagem, "outbox-publisher", tentativas);
        resultado.mortos += 1;
      } else {
        await deps.db
          .update(outbox)
          .set({ attempts: tentativas, lastError: mensagem })
          .where(eq(outbox.id, linha.id));
        resultado.falhas += 1;
      }
    }
  }

  return resultado;
}

async function enterrar(
  db: Db,
  linha: { id: string; eventName: string; payload: unknown; attempts: number },
  erro: string,
  consumidor: string,
  tentativas?: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(deadLetter).values({
      id: randomUUID(),
      consumer: consumidor,
      eventId: linha.id,
      eventName: linha.eventName,
      subject: linha.eventName,
      payload: linha.payload,
      error: erro,
      attempts: tentativas ?? linha.attempts,
    });

    // `dead_at`, não `published_at`: a linha desistiu, não foi entregue.
    await tx
      .update(outbox)
      .set({
        deadAt: new Date().toISOString(),
        lastError: erro,
        attempts: tentativas ?? linha.attempts,
      })
      .where(eq(outbox.id, linha.id));
  });
}

/**
 * Apaga do outbox o que já foi publicado há mais de `dias`.
 *
 * O outbox é fila, não histórico: o dado está nas tabelas de domínio e o
 * evento está no stream. Sem poda, a tabela cresce para sempre.
 */
export async function podarOutbox(db: Db, dias = 7): Promise<number> {
  const corte = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
  const apagados = await db
    .delete(outbox)
    .where(and(sql`${outbox.publishedAt} IS NOT NULL`, lt(outbox.publishedAt, corte)))
    .returning({ id: outbox.id });
  return apagados.length;
}

export interface LoopDePublicacao {
  parar: () => Promise<void>;
}

/**
 * Loop que publica o outbox periodicamente.
 *
 * Intervalo curto em vez de cron do pg-boss porque o cron do pg-boss tem
 * granularidade de minuto, e um minuto de atraso entre gravar a cotação e ela
 * aparecer no WebSocket seria perceptível.
 *
 * Um `LISTEN/NOTIFY` acordaria o loop na hora e é a evolução natural daqui;
 * com polling de um segundo a latência já é aceitável para carga diária, e o
 * polling tem uma propriedade que o NOTIFY não tem: funciona depois de o
 * processo ficar um tempo fora, sem depender de ter ouvido a notificação.
 */
export function iniciarLoopDePublicacao(
  deps: PublicarPendentesDeps & {
    intervaloMs?: number;
    aoFalhar?: (erro: Error) => void;
  },
): LoopDePublicacao {
  const intervalo = deps.intervaloMs ?? 1000;
  let parado = false;
  let emExecucao: Promise<void> = Promise.resolve();

  const temporizador = setInterval(() => {
    if (parado) return;
    emExecucao = emExecucao
      .then(async () => {
        if (parado) return;
        await publicarPendentes(deps);
      })
      .catch((erro: unknown) => {
        // Nunca deixa a corrente de promessas rejeitada: uma rodada que falha
        // não pode impedir a próxima.
        deps.aoFalhar?.(erro instanceof Error ? erro : new Error(String(erro)));
      });
  }, intervalo);

  temporizador.unref();

  return {
    async parar() {
      parado = true;
      clearInterval(temporizador);
      await emExecucao;
    },
  };
}
