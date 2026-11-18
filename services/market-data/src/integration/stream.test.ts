import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { WebSocket } from "ws";
import {
  conectar,
  linhaDeOutbox,
  envelopeDaLinha,
  type Messaging,
} from "@bolsiq/messaging";
import type { FastifyInstance } from "fastify";
import { criarApp } from "../app.js";
import { carregarEnv } from "../config.js";

const HOST = process.env.TEST_HOST ?? "127.0.0.1";

let nats: StartedTestContainer;
let messaging: Messaging;
let app: FastifyInstance;
let urlWs: string;

interface Coletor {
  todas: () => Record<string, unknown>[];
  esperarPor: (
    condicao: (msgs: Record<string, unknown>[]) => boolean,
    ms?: number,
  ) => Promise<Record<string, unknown>[]>;
  silencioPor: (ms: number) => Promise<Record<string, unknown>[]>;
}

/**
 * Coletor único por socket, com o listener anexado UMA vez.
 *
 * Anexar um listener novo a cada espera, com um array novo, perde o que chegou
 * no intervalo entre as esperas — e é exatamente o que acontece aqui: o
 * servidor repassa a cotação em milissegundos, antes de a espera seguinte
 * existir. A mensagem chegava ao socket e era descartada pelo teste.
 */
function coletorDe(socket: WebSocket): Coletor {
  const recebidas: Record<string, unknown>[] = [];

  socket.on("message", (dados: Buffer) => {
    recebidas.push(JSON.parse(dados.toString()) as Record<string, unknown>);
  });

  return {
    todas: () => [...recebidas],
    async esperarPor(condicao, ms = 10_000) {
      const limite = Date.now() + ms;
      while (Date.now() < limite) {
        if (condicao(recebidas)) return [...recebidas];
        await new Promise((r) => setTimeout(r, 50));
      }
      return [...recebidas];
    },
    async silencioPor(ms) {
      await new Promise((r) => setTimeout(r, ms));
      return [...recebidas];
    },
  };
}

async function abrir(url: string): Promise<{ socket: WebSocket; coletor: Coletor }> {
  const socket = new WebSocket(url);
  const coletor = coletorDe(socket);
  await new Promise((r) => socket.on("open", r));
  return { socket, coletor };
}

function publicarCotacao(ticker: string, preco: string): Promise<unknown> {
  const linha = linhaDeOutbox({
    name: "marketdata.quote.updated.v1",
    payload: { ticker, price: preco, change: "0.10", ts: "2026-10-31T21:05:00Z" },
    producer: "teste",
  });
  return messaging.publicar(envelopeDaLinha(linha));
}

beforeAll(async () => {
  nats = await new GenericContainer("nats:2-alpine")
    .withCommand(["-js", "-sd", "/data"])
    .withExposedPorts(4222)
    .withStartupTimeout(60_000)
    .start();

  const urlNats = `nats://${HOST}:${nats.getMappedPort(4222)}`;
  messaging = await conectar({ servers: urlNats, name: "teste-stream" });
  await messaging.garantirStream();

  app = await criarApp({
    env: carregarEnv({
      DATABASE_URL: "postgres://u:p@localhost:5432/db",
      NODE_ENV: "test",
      ROLE: "api",
    }),
    // O caminho do WebSocket não toca o banco; a sonda é um stub de propósito.
    verificarBanco: () => Promise.resolve(true),
    messaging,
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const endereco = app.server.address();
  const porta = typeof endereco === "object" && endereco ? endereco.port : 0;
  urlWs = `ws://127.0.0.1:${porta}/v1/stream`;
});

afterAll(async () => {
  await app?.close().catch(() => undefined);
  await messaging?.fechar().catch(() => undefined);
  await nats?.stop().catch(() => undefined);
});

describe("/v1/stream", () => {
  it("entrega ao cliente inscrito em PETR4 e só a ele", async () => {
    const { socket, coletor } = await abrir(urlWs);

    try {
      socket.send(JSON.stringify({ action: "subscribe", tickers: ["PETR4"] }));

      // Espera o reconhecimento antes de publicar, senão a cotação sai antes
      // de a assinatura existir.
      const confirmacao = await coletor.esperarPor((m) =>
        m.some((x) => x.type === "subscribed"),
      );
      expect(confirmacao.find((m) => m.type === "subscribed")).toMatchObject({
        tickers: ["PETR4"],
      });

      await publicarCotacao("PETR4", "38.42");
      await publicarCotacao("VALE3", "61.10");

      const recebidas = await coletor.esperarPor((m) =>
        m.some((x) => x.type === "quote"),
      );

      const cotacoes = recebidas.filter((m) => m.type === "quote");
      expect(cotacoes).toHaveLength(1);
      expect(cotacoes[0]).toMatchObject({
        type: "quote",
        ticker: "PETR4",
        price: "38.42",
      });
      // Preço como string, inclusive no WebSocket (regra 5).
      expect(typeof cotacoes[0]?.price).toBe("string");
    } finally {
      socket.close();
    }
  });

  it("para de entregar depois do unsubscribe", async () => {
    const { socket, coletor } = await abrir(urlWs);

    try {
      socket.send(JSON.stringify({ action: "subscribe", tickers: ["ITUB4"] }));
      await coletor.esperarPor((m) => m.some((x) => x.type === "subscribed"));

      socket.send(JSON.stringify({ action: "unsubscribe", tickers: ["ITUB4"] }));
      await coletor.esperarPor((m) => m.some((x) => x.type === "unsubscribed"));

      await publicarCotacao("ITUB4", "32.00");
      const depois = await coletor.silencioPor(2500);

      expect(depois.filter((m) => m.type === "quote")).toHaveLength(0);
    } finally {
      socket.close();
    }
  });

  it("responde erro a comando inválido sem derrubar a conexão", async () => {
    const { socket, coletor } = await abrir(urlWs);

    try {
      socket.send("isto não é JSON");
      const r = await coletor.esperarPor((m) => m.some((x) => x.type === "error"));
      expect(r.find((m) => m.type === "error")).toMatchObject({
        message: expect.stringContaining("JSON"),
      });

      // A conexão segue útil depois do erro.
      socket.send(JSON.stringify({ action: "ping" }));
      const pong = await coletor.esperarPor((m) => m.some((x) => x.type === "pong"));
      expect(pong.some((m) => m.type === "pong")).toBe(true);
      expect(socket.readyState).toBe(WebSocket.OPEN);
    } finally {
      socket.close();
    }
  });

  it("rejeita ticker inválido e mantém os válidos", async () => {
    const { socket, coletor } = await abrir(urlWs);

    try {
      socket.send(
        JSON.stringify({ action: "subscribe", tickers: ["BBDC4", "não-existe"] }),
      );
      const r = await coletor.esperarPor((m) => m.some((x) => x.type === "subscribed"));
      const confirmacao = r.find((m) => m.type === "subscribed");

      expect(confirmacao).toMatchObject({ tickers: ["BBDC4"] });
      expect(confirmacao?.rejected).toHaveLength(1);
    } finally {
      socket.close();
    }
  });
});
