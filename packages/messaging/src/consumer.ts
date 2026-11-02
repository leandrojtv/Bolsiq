import { randomUUID } from "node:crypto";
import { AckPolicy, DeliverPolicy, type JsMsg } from "nats";
import { EventEnvelope, SUBJECT_MARKETDATA, validarPayload } from "@bolsiq/contracts";
import {
  deadLetter,
  processedEvents,
  type Db,
  type TabelasDeConsumidor,
} from "@bolsiq/db-core";
import type { Messaging } from "./client.js";
import { MAX_ENTREGAS } from "./stream.js";
import { STREAM_MARKETDATA } from "@bolsiq/contracts";

/** Transação do Drizzle, como o callback de `db.transaction` a recebe. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface ContextoDeEvento {
  evento: EventEnvelope;
  /** Payload já validado contra o schema do catálogo. */
  payload: unknown;
  /**
   * Transação em que a marca de idempotência será gravada.
   *
   * Use-a para as escritas do handler. Assim o efeito e a marca de "já
   * processei" comitam juntos: não existe estado em que o dado foi gravado e
   * a marca não, nem o contrário.
   */
  tx: Tx;
}

export interface AssinarOptions {
  messaging: Messaging;
  db: Db;
  /** Nome durável do consumidor. Dois processos com o mesmo nome dividem a carga. */
  consumidor: string;
  /** Filtro de subject. Padrão: todos os eventos do domínio. */
  filtro?: string;
  maxTentativas?: number;
  /**
   * De onde começar a ler.
   *
   * `todas` (padrão) entrega o histórico retido no stream — é o correto em
   * produção: um consumidor novo precisa do que já aconteceu. `novas` entrega
   * só o que chegar depois da assinatura, e serve a consumidor efêmero e a
   * teste que não deve ver o histórico.
   */
  desde?: "todas" | "novas";
  /**
   * Tabelas de idempotencia e dead-letter do servico consumidor.
   *
   * Padrao: as do market_data. Outro servico passa as do proprio schema
   * (`tabelasDeConsumidor("alerts")`), para nao gravar no schema alheio.
   */
  tabelas?: TabelasDeConsumidor;
  /** Stream a consumir. Padrao: MARKETDATA. */
  stream?: string;
  manipular: (ctx: ContextoDeEvento) => Promise<void>;
  /** Chamado em erro; injetável para o teste não depender de logger. */
  aoFalhar?: (erro: Error, contexto: Record<string, unknown>) => void;
}

export interface Assinatura {
  parar: () => Promise<void>;
}

/**
 * Assina o stream com um consumidor durável, idempotente e com dead-letter.
 *
 * Três proteções, em camadas, porque nenhuma basta sozinha:
 *
 * 1. **Deduplicação do JetStream** por `Nats-Msg-Id`, dentro da janela.
 * 2. **`processed_events`**, para o que passa da janela — e passa, porque
 *    reentrega acontece sempre que um consumidor processa e morre antes do ack.
 * 3. **Dead-letter** após N entregas, para payload inválido ou bug de handler
 *    não bloquearem a fila atrás deles.
 */
export async function assinar(opts: AssinarOptions): Promise<Assinatura> {
  const maxTentativas = opts.maxTentativas ?? MAX_ENTREGAS;
  const filtro = opts.filtro ?? SUBJECT_MARKETDATA;

  const stream = opts.stream ?? STREAM_MARKETDATA;
  await opts.messaging.jsm.consumers.add(stream, {
    durable_name: opts.consumidor,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: opts.desde === "novas" ? DeliverPolicy.New : DeliverPolicy.All,
    filter_subject: filtro,
    // max_deliver no broker é o cinto de segurança; a contagem que decide a
    // dead-letter é a nossa, logo abaixo.
    max_deliver: maxTentativas + 1,
    ack_wait: 30_000_000_000,
  });

  const consumidor = await opts.messaging.js.consumers.get(stream, opts.consumidor);
  const mensagens = await consumidor.consume();

  let parado = false;

  const laco = (async () => {
    for await (const msg of mensagens) {
      if (parado) break;
      await processar(msg, opts, maxTentativas);
    }
  })();

  return {
    async parar() {
      parado = true;
      mensagens.stop();
      await laco;
    },
  };
}

async function processar(
  msg: JsMsg,
  opts: AssinarOptions,
  maxTentativas: number,
): Promise<void> {
  const entregas = msg.info.redeliveryCount;

  let envelope: EventEnvelope;
  try {
    const bruto: unknown = JSON.parse(new TextDecoder().decode(msg.data));
    envelope = EventEnvelope.parse(bruto);
  } catch (erro) {
    // Envelope ilegível não melhora com retry. Vai direto para a dead-letter.
    await enterrar(opts, msg, null, mensagemDeErro(erro), entregas);
    msg.term();
    return;
  }

  const validacao = validarPayload(envelope.name, envelope.payload);
  if (!validacao.ok) {
    await enterrar(opts, msg, envelope, validacao.erro, entregas);
    msg.term();
    return;
  }

  try {
    const jaProcessado = await opts.db.transaction(async (tx) => {
      const inserido = await tx
        .insert(tabelasDe(opts).processedEvents)
        .values({
          consumer: opts.consumidor,
          eventId: envelope.id,
          eventName: envelope.name,
        })
        .onConflictDoNothing()
        .returning({ eventId: tabelasDe(opts).processedEvents.eventId });

      // Conflito: outro processo (ou outra entrega) já cuidou deste evento.
      if (inserido.length === 0) {
        return true;
      }

      await opts.manipular({ evento: envelope, payload: validacao.payload, tx });
      return false;
    });

    if (jaProcessado) {
      opts.aoFalhar?.(new Error("evento repetido, ignorado"), {
        consumidor: opts.consumidor,
        evento: envelope.id,
        nivel: "debug",
      });
    }

    msg.ack();
  } catch (erro) {
    if (entregas >= maxTentativas) {
      await enterrar(opts, msg, envelope, mensagemDeErro(erro), entregas);
      msg.term();
      return;
    }

    opts.aoFalhar?.(erro instanceof Error ? erro : new Error(String(erro)), {
      consumidor: opts.consumidor,
      evento: envelope.id,
      entregas,
    });

    // Backoff exponencial, com teto de um minuto.
    msg.nak(Math.min(2 ** entregas * 1000, 60_000));
  }
}

async function enterrar(
  opts: AssinarOptions,
  msg: JsMsg,
  envelope: EventEnvelope | null,
  erro: string,
  entregas: number,
): Promise<void> {
  opts.aoFalhar?.(new Error(erro), {
    consumidor: opts.consumidor,
    subject: msg.subject,
    evento: envelope?.id ?? null,
    entregas,
    deadLetter: true,
  });

  await opts.db.insert(tabelasDe(opts).deadLetter).values({
    id: randomUUID(),
    consumer: opts.consumidor,
    eventId: envelope?.id ?? null,
    eventName: envelope?.name ?? null,
    subject: msg.subject,
    payload: envelope?.payload ?? null,
    error: erro,
    attempts: entregas + 1,
  });
}

function mensagemDeErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

function tabelasDe(opts: AssinarOptions): TabelasDeConsumidor {
  return opts.tabelas ?? { processedEvents, deadLetter };
}
