import { randomUUID } from "node:crypto";
import { validarPayload } from "@bolsiq/contracts";
import type { EventEnvelope } from "@bolsiq/contracts";
import { paraIsoUtc } from "./datas.js";

export interface NovoEvento {
  name: string;
  payload: unknown;
  producer: string;
  /** Quando o fato aconteceu. Padrão: agora. */
  occurredAt?: string;
}

export interface LinhaDeOutbox {
  id: string;
  eventName: string;
  payload: unknown;
  occurredAt: string;
  producer: string;
}

/**
 * Monta a linha a inserir no outbox, validando o payload contra o catálogo.
 *
 * Devolve a linha em vez de inseri-la, de propósito: quem grava o dado precisa
 * inserir **na própria transação**, com o seu `tx`. Se a inserção do evento
 * usasse outra conexão, o evento poderia existir sem o dado — exatamente o que
 * o outbox existe para impedir.
 *
 * ```ts
 * await db.transaction(async (tx) => {
 *   await tx.insert(quotesDaily).values(cotacao);
 *   await tx.insert(outbox).values(linhaDeOutbox({ ... }));
 * });
 * ```
 */
export function linhaDeOutbox(evento: NovoEvento): LinhaDeOutbox {
  const validacao = validarPayload(evento.name, evento.payload);
  if (!validacao.ok) {
    // Falhar aqui, na escrita, e não na publicação: é o único momento em que
    // existe uma pilha de chamadas apontando para quem produziu o evento
    // errado. Descobrir isso depois, no publisher, só diz que alguém errou.
    throw new Error(`evento rejeitado antes do outbox — ${validacao.erro}`);
  }

  return {
    id: randomUUID(),
    eventName: evento.name,
    payload: validacao.payload,
    occurredAt: evento.occurredAt ?? new Date().toISOString(),
    producer: evento.producer,
  };
}

/**
 * Monta o envelope publicado no NATS a partir da linha do outbox.
 *
 * `occurred_at` passa por `paraIsoUtc` porque o Postgres devolve `timestamptz`
 * no formato dele, não em ISO. Sem isso o consumidor rejeita o evento.
 */
export function envelopeDaLinha(linha: {
  id: string;
  eventName: string;
  payload: unknown;
  occurredAt: string | Date;
  producer: string;
}): EventEnvelope {
  return {
    id: linha.id,
    name: linha.eventName,
    occurred_at: paraIsoUtc(linha.occurredAt),
    producer: linha.producer,
    payload: linha.payload,
  };
}

export interface Publicador {
  /** Publica e informa se o broker reconheceu como duplicata. */
  publicar: (envelope: EventEnvelope) => Promise<{ duplicate: boolean }>;
}

export interface ResultadoPublicacao {
  publicados: number;
  duplicados: number;
  falhas: number;
  mortos: number;
}
