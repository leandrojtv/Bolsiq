import { z } from "zod";
import { IsoDateTime } from "../primitives.js";

/**
 * Envelope comum a todo evento.
 *
 * O `id` é o id da linha no outbox, e é ele que vai no header `Nats-Msg-Id`.
 * Isso liga as duas pontas da garantia: o outbox entrega ao menos uma vez, e o
 * JetStream descarta a repetição dentro da janela de deduplicação. Fora dessa
 * janela, quem protege é a tabela `processed_events` no consumidor.
 */
export const EventEnvelope = z.object({
  /** Id da linha no outbox. Usado como `Nats-Msg-Id`. */
  id: z.string().uuid(),
  /** Nome versionado do evento, ex. `marketdata.quote.updated.v1`. */
  name: z.string().min(1),
  /** Quando o fato aconteceu, não quando foi publicado. */
  occurred_at: IsoDateTime,
  /** Serviço que produziu, ex. `market-data`. */
  producer: z.string().min(1),
  payload: z.unknown(),
});

export type EventEnvelope = z.infer<typeof EventEnvelope>;

/**
 * Nome de evento: `<domínio>.<entidade>.<ação>.v<N>`.
 *
 * A versão está no nome, não num campo. Quebrar o payload exige um nome novo,
 * e os dois convivem enquanto houver consumidor do antigo — é o mesmo
 * princípio do `/v1` da API pública, aplicado ao barramento.
 */
export const EVENT_NAME_PATTERN = /^[a-z]+(\.[a-z]+)+\.v[0-9]+$/;
