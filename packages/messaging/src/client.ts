import {
  connect,
  DiscardPolicy,
  RetentionPolicy,
  StorageType,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
} from "nats";
import { STREAM_MARKETDATA, streams, type EventEnvelope } from "@bolsiq/contracts";
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
      // Mesma configuracao para todos os streams; o que difere e nome e
      // subject. Quando um produtor precisar de retencao propria, ganha config
      // propria aqui.
      for (const s of Object.values(streams)) {
        const config = {
          name: s.name,
          subjects: [s.subject],
          retention: RetentionPolicy.Limits,
          max_msgs: streamMarketData.max_msgs,
          max_bytes: streamMarketData.max_bytes,
          max_age: streamMarketData.max_age_ns,
          duplicate_window: streamMarketData.duplicate_window_ns,
          storage: StorageType.File,
          num_replicas: streamMarketData.num_replicas,
          discard: DiscardPolicy.Old,
        };

        for (let tentativa = 1; ; tentativa++) {
          try {
            await jsm.streams.add(config);
            break;
          } catch {
            try {
              // Já existe: atualiza para o que está versionado em stream.ts,
              // para o broker não ficar com configuração de um deploy anterior.
              await jsm.streams.update(s.name, config);
              break;
            } catch (erro) {
              // O add falhou e o stream não existe: o JetStream ainda está
              // subindo. Visto no CI, com o broker recém-criado aceitando a
              // conexão antes de aceitar comando de JetStream.
              if (tentativa >= 20) throw erro;
              await new Promise((r) => setTimeout(r, 250 * tentativa));
            }
          }
        }
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
