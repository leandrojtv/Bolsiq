import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conversar } from "./conversa.js";
import { fontesDeTeste, HOJE } from "../eval/base.js";
import { criarFerramentas } from "./ferramentas.js";
import { montarSistema } from "./prompt.js";
import { criarModelo } from "./provedores.js";

const CHAVE = "sk-chave-que-nunca-pode-sair-1234567890";

/** Texto de tudo o que foi para o console durante o teste. */
function capturarConsole() {
  const linhas: string[] = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      linhas.push(
        a
          .map((x) =>
            x instanceof Error
              ? `${x.message} ${x.stack} ${JSON.stringify(x)}`
              : JSON.stringify(x),
          )
          .join(" "),
      );
    });
  }
  return linhas;
}

async function rodar(f: typeof fetch) {
  const erros: string[] = [];
  const r = conversar({
    modelo: criarModelo(
      { provedor: "deepseek", chave: CHAVE, baseUrl: "http://fake" },
      "m",
      f,
    ),
    sistema: montarSistema({ modo: "personal", hoje: HOJE }),
    mensagens: [{ role: "user", content: "Avalie minha carteira" }],
    ferramentas: criarFerramentas(fontesDeTeste(), { hoje: HOJE, modo: "personal" }),
    segredos: [CHAVE],
    aoErrar: (m) => erros.push(m),
  });
  const resposta = r.toUIMessageStreamResponse({
    onError: () => "O provedor recusou a chamada.",
  });
  return {
    corpo: await resposta.text(),
    erros,
    cabecalhos: JSON.stringify([...resposta.headers]),
  };
}

describe("a chave nao sai", () => {
  let console_: string[];
  beforeEach(() => {
    console_ = capturarConsole();
  });
  afterEach(() => vi.restoreAllMocks());

  it("com o provedor devolvendo a chave no erro", async () => {
    const f = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { message: `Incorrect API key: ${CHAVE}` } }),
          {
            status: 401,
            headers: { "content-type": "application/json", "x-eco": CHAVE },
          },
        ),
      )) as typeof fetch;
    const { corpo, erros, cabecalhos } = await rodar(f);
    expect(erros.length).toBeGreaterThan(0);
    expect(corpo).not.toContain(CHAVE);
    expect(cabecalhos).not.toContain(CHAVE);
    expect(erros.join()).not.toContain(CHAVE);
    expect(console_.join()).not.toContain(CHAVE);
  });

  it("com falha de rede que cita a chave", async () => {
    const f = (() =>
      Promise.reject(new TypeError(`fetch failed ${CHAVE}`))) as typeof fetch;
    const { corpo, erros } = await rodar(f);
    expect(corpo).not.toContain(CHAVE);
    expect(erros.join()).not.toContain(CHAVE);
    expect(console_.join()).not.toContain(CHAVE);
  });

  it("a chave vai so no cabecalho de autorizacao", async () => {
    const pedidos: { url: string; corpo: string; auth: string | null }[] = [];
    const f = ((url: string, init?: RequestInit) => {
      pedidos.push({
        url: String(url),
        corpo: init?.body as string,
        auth: new Headers(init?.headers).get("authorization"),
      });
      return Promise.resolve(new Response("{}", { status: 500 }));
    }) as typeof fetch;
    await rodar(f);
    expect(pedidos[0]?.auth).toBe(`Bearer ${CHAVE}`);
    expect(pedidos[0]?.url).not.toContain(CHAVE);
    expect(pedidos[0]?.corpo).not.toContain(CHAVE);
  });
});
