import { EventEnvelope, validarPayload } from "@bolsiq/contracts";
import type { Messaging } from "./client.js";

export interface AssinaturaEfemera {
  parar: () => Promise<void>;
}

export interface AssinarEfemeroOptions {
  messaging: Messaging;
  /** Subject a escutar, ex. `marketdata.quote.updated.v1`. */
  filtro: string;
  manipular: (evento: EventEnvelope, payload: unknown) => void;
  aoFalhar?: (erro: Error, contexto: Record<string, unknown>) => void;
}

/**
 * Assinatura efêmera, sem estado e sem ack.
 *
 * Usa a assinatura **core** do NATS, não o JetStream, de propósito. Uma
 * publicação JetStream é uma mensagem NATS comum que o stream também captura,
 * então um assinante core a recebe em tempo real.
 *
 * É o que serve ao repasse para WebSocket: quem acabou de conectar quer o preço
 * de agora, não o histórico do stream. Um consumidor durável com
 * `processed_events` seria errado aqui por dois motivos — guardaria estado por
 * cliente de WebSocket, e depois de uma reconexão despejaria horas de cotações
 * velhas na tela de quem só quer acompanhar o mercado.
 *
 * Garantia: **at-most-once**. Se o processo cair, a cotação perdida não volta —
 * e não deve: a próxima atualização do mesmo ticker a torna irrelevante. Quem
 * precisa de garantia de entrega usa `assinar`, com outbox e idempotência.
 */
export function assinarEfemero(opts: AssinarEfemeroOptions): AssinaturaEfemera {
  const assinatura = opts.messaging.conexao.subscribe(opts.filtro);

  const laco = (async () => {
    for await (const msg of assinatura) {
      try {
        const bruto: unknown = JSON.parse(new TextDecoder().decode(msg.data));
        const envelope = EventEnvelope.parse(bruto);
        const validacao = validarPayload(envelope.name, envelope.payload);

        if (!validacao.ok) {
          opts.aoFalhar?.(new Error(validacao.erro), { subject: msg.subject });
          continue;
        }

        opts.manipular(envelope, validacao.payload);
      } catch (erro) {
        // Uma mensagem ruim não derruba o repasse das outras.
        opts.aoFalhar?.(erro instanceof Error ? erro : new Error(String(erro)), {
          subject: msg.subject,
        });
      }
    }
  })();

  return {
    async parar() {
      assinatura.unsubscribe();
      await laco;
    },
  };
}
