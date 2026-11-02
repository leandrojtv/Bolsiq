import {
  connect,
  DiscardPolicy,
  RetentionPolicy,
  StorageType,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
} from "nats";
import { STREAM_MARKETDATA, type EventEnvelope } from "@bolsiq/contracts";
import { streamMarketData } from "./stream.js";

export interface MessagingOptions {
  servers: string;
  /** Nome da conexão; aparece em `nats server report connections`. */
  name: string;
}

export interface Messaging {
  conexao: NatsConnection;
  js: JetStreamClient;
  jsm: JetStreamManager;
  publicar: (envelope: EventEnvelope) => Promise<{ duplicate: boolean; seq: number }>;
  garantirStream: () => Promise<void>;
  fechar: () => Promise<void>;
}

export async function conectar(opts: MessagingOptions): Promise<Messaging> {
  const conexao = await connect({
    servers: opts.servers,
    name: opts.name,
    // Reconexão indefinida: o serviço não deve morrer porque o broker
    // reiniciou. Enquanto o NATS está fora, o outbox acumula e o publisher
    // tenta de novo — é essa combinação que dá at-least-once.
    maxReconnectAttempts: -1,
    reconnectTimeWait: 1000,
    waitOnFirstConnect: true,
  });

  const js = conexao.jetstream();
  const jsm = await conexao.jetstreamManager();

  return {
    conexao,
    js,
    jsm,

    async garantirStream() {
      // stream.ts fica sem dependência do `nats` de propósito: é configuração,
      // e configuração que importa o cliente não dá para ler sem o cliente.
      // A tradução para os enums da biblioteca acontece aqui.
      const config = {
        name: streamMarketData.name,
        subjects: [...streamMarketData.subjects],
        retention: RetentionPolicy.Limits,
        max_msgs: streamMarketData.max_msgs,
        max_bytes: streamMarketData.max_bytes,
        max_age: streamMarketData.max_age_ns,
        duplicate_window: streamMarketData.duplicate_window_ns,
        storage: StorageType.File,
        num_replicas: streamMarketData.num_replicas,
        discard: DiscardPolicy.Old,
      };

      try {
        await jsm.streams.add(config);
      } catch {
        // Já existe: atualiza para o que está versionado em stream.ts, para o
        // broker não ficar com configuração antiga de um deploy anterior.
        await jsm.streams.update(streamMarketData.name, config);
      }
    },

    async publicar(envelope: EventEnvelope) {
      const dados = new TextEncoder().encode(JSON.stringify(envelope));

      // `msgID` vira o header Nats-Msg-Id, e é o id da linha do outbox. É o
      // que permite ao JetStream descartar a republicação dentro da janela de
      // deduplicação.
      const ack = await js.publish(envelope.name, dados, { msgID: envelope.id });

      return { duplicate: ack.duplicate, seq: ack.seq };
    },

    async fechar() {
      await conexao.drain();
    },
  };
}

export { STREAM_MARKETDATA };
