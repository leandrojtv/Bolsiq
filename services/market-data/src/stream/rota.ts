import websocket from "@fastify/websocket";
import { assinarEfemero, type AssinaturaEfemera } from "@bolsiq/messaging";
import type { Messaging } from "@bolsiq/messaging";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { RegistroDeAssinantes, type ClienteStream } from "./assinantes.js";
import {
  analisarComando,
  mensagemDeAssinatura,
  mensagemDeCotacao,
  mensagemDeErro,
} from "./protocolo.js";

export interface StreamRegistrado {
  registro: RegistroDeAssinantes;
  /**
   * Liga o repasse do NATS para os clientes.
   *
   * Separado do registro da rota de propósito: o `server.ts` sobe o HTTP antes
   * de conectar ao barramento, para o health responder mesmo com o NATS fora.
   * Se a rota só existisse quando houvesse conexão, o `/v1/stream` devolveria
   * 404 no serviço real — e foi o que aconteceu.
   */
  ligar: (messaging: Messaging) => void;
  ligado: () => boolean;
  parar: () => Promise<void>;
}

/**
 * Registra o `/v1/stream`.
 *
 * Uma única assinatura no NATS alimenta todos os clientes, não uma por
 * conexão: com uma por cliente, mil navegadores abertos seriam mil assinaturas
 * recebendo o universo inteiro.
 */
export async function registrarStream(app: FastifyInstance): Promise<StreamRegistrado> {
  const registro = new RegistroDeAssinantes();

  await app.register(websocket, {
    options: { maxPayload: 16 * 1024 },
  });

  let assinatura: AssinaturaEfemera | undefined;

  app.register((instancia, _opts, done) => {
    instancia.get("/v1/stream", { websocket: true }, (conexao: WebSocket) => {
      const cliente: ClienteStream = {
        enviar: (mensagem) => {
          conexao.send(mensagem);
        },
      };

      conexao.on("message", (bruto: Buffer) => {
        const analise = analisarComando(bruto.toString());
        if (!analise.ok) {
          conexao.send(mensagemDeErro(analise.erro));
          return;
        }

        switch (analise.comando.action) {
          case "subscribe": {
            const r = registro.assinar(cliente, analise.comando.tickers);
            conexao.send(mensagemDeAssinatura("subscribed", r.aceitos, r.rejeitados));
            break;
          }
          case "unsubscribe": {
            registro.cancelar(cliente, analise.comando.tickers);
            conexao.send(
              mensagemDeAssinatura("unsubscribed", registro.tickersDe(cliente)),
            );
            break;
          }
          case "ping": {
            conexao.send(JSON.stringify({ type: "pong" }));
            break;
          }
        }
      });

      // Sem isto o registro cresce para sempre: cada aba fechada deixaria um
      // socket morto indexado por ticker.
      conexao.on("close", () => {
        registro.remover(cliente);
      });
      conexao.on("error", () => {
        registro.remover(cliente);
      });
    });

    done();
  });

  return {
    registro,

    ligar: (messaging: Messaging) => {
      if (assinatura) return;
      assinatura = assinarEfemero({
        messaging,
        filtro: "marketdata.quote.updated.v1",
        manipular: (_evento, payload) => {
          const cotacao = payload as {
            ticker: string;
            price: string;
            change: string;
            ts: string;
          };
          registro.publicar(cotacao.ticker, mensagemDeCotacao(cotacao));
        },
        aoFalhar: (erro, contexto) => {
          app.log.warn({ err: erro, ...contexto }, "evento descartado no stream");
        },
      });
      app.log.info("repasse do /v1/stream ligado");
    },

    ligado: () => assinatura !== undefined,

    parar: async () => {
      await assinatura?.parar();
      assinatura = undefined;
    },
  };
}
