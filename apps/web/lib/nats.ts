import "server-only";
import { connect, type NatsConnection } from "nats";
import { env } from "./env";

let conexao: Promise<NatsConnection> | undefined;

/** Uma conexao por processo do app, compartilhada pelos SSE do sino. */
export function nats(): Promise<NatsConnection> {
  conexao ??= connect({
    servers: env.NATS_URL,
    name: "web",
    maxReconnectAttempts: -1,
    reconnectTimeWait: 1000,
  }).catch((erro: unknown) => {
    conexao = undefined;
    throw erro;
  });
  return conexao;
}
