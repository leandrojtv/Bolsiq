import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { mensagemSegura } from "./chaves.js";
import { PROVEDORES, type ModeloListado, type Provedor } from "./catalogo.js";

/** Chave e endereco de uma chamada. Vive so durante a requisicao. */
export interface Credencial {
  provedor: Provedor;
  chave?: string | null;
  /** Ollama: URL ja validada com `urlDoOllama`. */
  baseUrl?: string | null;
}

type Fetch = typeof fetch;

const BASE = {
  deepseek: "https://api.deepseek.com",
  openrouter: "https://openrouter.ai/api/v1",
} as const;

export const OLLAMA_PADRAO = "http://host.docker.internal:11434";

/**
 * A URL do Ollama vem do usuario e quem chama e o servidor. Sem a lista de hosts
 * permitidos, o campo viraria uma porta para a rede interna (SSRF).
 */
export function urlDoOllama(url: string, hostsPermitidos: readonly string[]): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ErroDoProvedor("URL do Ollama inválida.");
  }
  if (!["http:", "https:"].includes(u.protocol) || !hostsPermitidos.includes(u.hostname))
    throw new ErroDoProvedor(
      `Host ${u.hostname} fora da lista permitida (ASSISTANT_OLLAMA_HOSTS).`,
    );
  return u.origin;
}

export class ErroDoProvedor extends Error {}

/** Sem seguir redirecionamento: um 302 tiraria a chamada do host permitido. */
const semRedirecionar =
  (f: Fetch): Fetch =>
  (url, init) =>
    f(url, { ...init, redirect: "error" });

/** Modelo do AI SDK para qualquer provedor: a unica diferenca de codigo entre eles. */
export function criarModelo(
  c: Credencial,
  modelo: string,
  f: Fetch = fetch,
): LanguageModel {
  const apiKey = c.chave ?? "";
  const seguro = semRedirecionar(f);
  switch (c.provedor) {
    case "anthropic":
      return createAnthropic({ apiKey, fetch: seguro })(modelo);
    case "openai":
      return createOpenAI({ apiKey, fetch: seguro }).chat(modelo);
    case "google":
      return createGoogleGenerativeAI({ apiKey, fetch: seguro })(modelo);
    case "deepseek":
    case "openrouter":
      return createOpenAICompatible({
        name: c.provedor,
        baseURL: c.baseUrl ?? BASE[c.provedor],
        apiKey,
        includeUsage: true,
        fetch: seguro,
      })(modelo);
    case "ollama":
      return createOpenAICompatible({
        name: "ollama",
        baseURL: `${c.baseUrl ?? OLLAMA_PADRAO}/v1`,
        ...(apiKey ? { apiKey } : {}),
        includeUsage: true,
        fetch: seguro,
      })(modelo);
  }
}

const MILHAO = 1_000_000;
const porMilhao = (v: string | undefined) => {
  const n = Number(v);
  return v === undefined || Number.isNaN(n) || n < 0
    ? null
    : Number((n * MILHAO).toFixed(4));
};

async function obter(
  url: string,
  headers: Record<string, string>,
  f: Fetch,
): Promise<unknown> {
  const r = await semRedirecionar(f)(url, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    throw new ErroDoProvedor(
      r.status === 401 || r.status === 403
        ? "O provedor recusou a chave."
        : `O provedor respondeu ${r.status}.`,
    );
  }
  return r.json();
}

const simples = (id: string, nome = id): ModeloListado => ({
  id,
  nome,
  preco_entrada: null,
  preco_saida: null,
  ferramentas: null,
});

/** O que nao e chat na lista da OpenAI (embeddings, audio, imagem). */
const NAO_E_CHAT =
  /embedding|whisper|tts|dall-e|image|moderation|audio|realtime|transcribe|sora/;

/** Lista de modelos, com preco e suporte a ferramentas quando o provedor informa. */
export async function listarModelos(
  c: Credencial,
  f: Fetch = fetch,
): Promise<ModeloListado[]> {
  const chave = c.chave ?? "";
  switch (c.provedor) {
    case "anthropic": {
      const r = (await obter(
        "https://api.anthropic.com/v1/models?limit=100",
        { "x-api-key": chave, "anthropic-version": "2023-06-01" },
        f,
      )) as { data: { id: string; display_name?: string }[] };
      return r.data.map((m) => simples(m.id, m.display_name ?? m.id));
    }
    case "openai": {
      const r = (await obter(
        "https://api.openai.com/v1/models",
        { authorization: `Bearer ${chave}` },
        f,
      )) as { data: { id: string }[] };
      return r.data.filter((m) => !NAO_E_CHAT.test(m.id)).map((m) => simples(m.id));
    }
    case "google": {
      const r = (await obter(
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
        { "x-goog-api-key": chave },
        f,
      )) as {
        models: {
          name: string;
          displayName?: string;
          supportedGenerationMethods?: string[];
        }[];
      };
      return r.models
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => simples(m.name.replace(/^models\//, ""), m.displayName));
    }
    case "deepseek": {
      const r = (await obter(
        `${c.baseUrl ?? BASE.deepseek}/models`,
        { authorization: `Bearer ${chave}` },
        f,
      )) as { data: { id: string }[] };
      return r.data.map((m) => simples(m.id));
    }
    case "openrouter": {
      const r = (await obter(
        `${c.baseUrl ?? BASE.openrouter}/models`,
        { authorization: `Bearer ${chave}` },
        f,
      )) as {
        data: {
          id: string;
          name?: string;
          pricing?: { prompt?: string; completion?: string };
          supported_parameters?: string[];
        }[];
      };
      return r.data.map((m) => ({
        id: m.id,
        nome: m.name ?? m.id,
        preco_entrada: porMilhao(m.pricing?.prompt),
        preco_saida: porMilhao(m.pricing?.completion),
        ferramentas: m.supported_parameters
          ? m.supported_parameters.includes("tools")
          : null,
      }));
    }
    case "ollama": {
      const base = c.baseUrl ?? OLLAMA_PADRAO;
      const r = (await obter(`${base}/api/tags`, {}, f)) as {
        models: { name: string }[];
      };
      return Promise.all(
        r.models.map(async (m) => {
          const show = await semRedirecionar(f)(`${base}/api/show`, {
            method: "POST",
            body: JSON.stringify({ model: m.name }),
            signal: AbortSignal.timeout(15_000),
          })
            .then((x) =>
              x.ok ? (x.json() as Promise<{ capabilities?: string[] }>) : null,
            )
            .catch(() => null);
          return {
            ...simples(m.name),
            preco_entrada: 0,
            preco_saida: 0,
            ferramentas: show?.capabilities ? show.capabilities.includes("tools") : null,
          };
        }),
      );
    }
  }
}

export type ResultadoDoTeste =
  { ok: true; modelos: ModeloListado[] } | { ok: false; mensagem: string };

/**
 * Chamada minima: listar modelos autentica sem gastar token. A lista da
 * OpenRouter e publica, entao la a chave e conferida em /key antes.
 */
export async function testarConexao(
  c: Credencial,
  f: Fetch = fetch,
): Promise<ResultadoDoTeste> {
  if (PROVEDORES[c.provedor].exigeChave && !c.chave)
    return { ok: false, mensagem: "Informe a chave." };
  try {
    if (c.provedor === "openrouter")
      await obter(
        `${c.baseUrl ?? BASE.openrouter}/key`,
        { authorization: `Bearer ${c.chave ?? ""}` },
        f,
      );
    return { ok: true, modelos: await listarModelos(c, f) };
  } catch (erro) {
    return {
      ok: false,
      mensagem:
        erro instanceof ErroDoProvedor
          ? erro.message
          : `Não foi possível falar com o provedor: ${mensagemSegura(erro, [c.chave ?? ""])}`,
    };
  }
}
