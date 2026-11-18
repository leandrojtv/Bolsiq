import { describe, expect, it } from "vitest";
import { classificarModelo, NOMES_DE_PROVEDOR, type ModeloListado } from "./catalogo.js";
import {
  criarModelo,
  ErroDoProvedor,
  listarModelos,
  testarConexao,
  urlDoOllama,
} from "./provedores.js";

const CHAVE = "chave-secreta-de-teste-9876";

function falso(respostas: Record<string, unknown>, status = 200) {
  const chamadas: { url: string; init: RequestInit | undefined }[] = [];
  const f = ((url: string, init?: RequestInit) => {
    chamadas.push({ url: String(url), init });
    const chave = Object.keys(respostas).find((k) => String(url).includes(k));
    return Promise.resolve(
      new Response(JSON.stringify(chave ? respostas[chave] : {}), {
        status: chave ? status : 404,
      }),
    );
  }) as typeof fetch;
  return { f, chamadas };
}

describe("lista de modelos", () => {
  it("OpenRouter traz preco por milhao e suporte a ferramentas", async () => {
    const { f } = falso({
      "/models": {
        data: [
          {
            id: "a/b",
            name: "AB",
            pricing: { prompt: "0.000003", completion: "0.000015" },
            supported_parameters: ["tools"],
          },
          { id: "c/d", pricing: { prompt: "-1" }, supported_parameters: ["top_p"] },
        ],
      },
    });
    const [ab, cd] = await listarModelos({ provedor: "openrouter", chave: CHAVE }, f);
    expect(ab).toMatchObject({
      id: "a/b",
      nome: "AB",
      preco_entrada: 3,
      preco_saida: 15,
      ferramentas: true,
    });
    expect(cd).toMatchObject({ preco_entrada: null, ferramentas: false });
  });

  it("OpenAI esconde o que nao e chat", async () => {
    const { f, chamadas } = falso({
      "/v1/models": {
        data: [{ id: "gpt-x" }, { id: "text-embedding-3" }, { id: "whisper-1" }],
      },
    });
    const m = await listarModelos({ provedor: "openai", chave: CHAVE }, f);
    expect(m.map((x) => x.id)).toEqual(["gpt-x"]);
    expect((chamadas[0]?.init?.headers as Record<string, string>).authorization).toBe(
      `Bearer ${CHAVE}`,
    );
    expect(chamadas[0]?.url).not.toContain(CHAVE);
  });

  it("Google usa cabecalho, nao URL, e filtra generateContent", async () => {
    const { f, chamadas } = falso({
      "/v1beta/models": {
        models: [
          {
            name: "models/gemini-x",
            displayName: "Gemini X",
            supportedGenerationMethods: ["generateContent"],
          },
          { name: "models/emb", supportedGenerationMethods: ["embedContent"] },
        ],
      },
    });
    const m = await listarModelos({ provedor: "google", chave: CHAVE }, f);
    expect(m).toEqual([expect.objectContaining({ id: "gemini-x", nome: "Gemini X" })]);
    expect(chamadas[0]?.url).not.toContain(CHAVE);
  });

  it("Anthropic e DeepSeek listam com a propria autenticacao", async () => {
    const a = falso({
      "api.anthropic.com": { data: [{ id: "claude-x", display_name: "Claude X" }] },
    });
    expect(
      (await listarModelos({ provedor: "anthropic", chave: CHAVE }, a.f))[0]?.nome,
    ).toBe("Claude X");
    expect((a.chamadas[0]?.init?.headers as Record<string, string>)["x-api-key"]).toBe(
      CHAVE,
    );
    const d = falso({ "/models": { data: [{ id: "deepseek-flash" }] } });
    const lista = await listarModelos(
      { provedor: "deepseek", chave: CHAVE, baseUrl: "http://fake" },
      d.f,
    );
    expect(lista[0]?.id).toBe("deepseek-flash");
    expect(d.chamadas[0]?.url).toBe("http://fake/models");
  });

  it("Ollama le as capacidades de cada modelo", async () => {
    const { f } = falso({
      "/api/tags": { models: [{ name: "com:1" }] },
      "/api/show": { capabilities: ["completion", "tools"] },
    });
    const [m] = await listarModelos(
      { provedor: "ollama", baseUrl: "http://ollama:11434" },
      f,
    );
    expect(m).toMatchObject({ id: "com:1", ferramentas: true, preco_entrada: 0 });
  });

  it("nao segue redirecionamento", async () => {
    const { f, chamadas } = falso({ "/models": { data: [] } });
    await listarModelos({ provedor: "deepseek", chave: CHAVE }, f);
    expect(chamadas[0]?.init?.redirect).toBe("error");
  });
});

describe("testar conexao", () => {
  it("sem chave nem chama o provedor", async () => {
    const { f, chamadas } = falso({});
    expect(await testarConexao({ provedor: "openai" }, f)).toEqual({
      ok: false,
      mensagem: "Informe a chave.",
    });
    expect(chamadas).toHaveLength(0);
  });

  it("chave recusada vira mensagem, sem repetir a chave", async () => {
    const { f } = falso({ "/models": { erro: CHAVE } }, 401);
    const r = await testarConexao({ provedor: "deepseek", chave: CHAVE }, f);
    expect(r).toEqual({ ok: false, mensagem: "O provedor recusou a chave." });
    const g = falso({ "/models": {} }, 500);
    expect(await testarConexao({ provedor: "deepseek", chave: CHAVE }, g.f)).toEqual({
      ok: false,
      mensagem: "O provedor respondeu 500.",
    });
  });

  it("falha de rede nao vaza a chave", async () => {
    const f = (() => Promise.reject(new Error(`falhou com ${CHAVE}`))) as typeof fetch;
    const r = await testarConexao({ provedor: "deepseek", chave: CHAVE }, f);
    expect(JSON.stringify(r)).not.toContain(CHAVE);
    expect(r.ok).toBe(false);
  });

  it("OpenRouter confere a chave antes da lista publica", async () => {
    const { f, chamadas } = falso({ "/key": {}, "/models": { data: [] } });
    expect((await testarConexao({ provedor: "openrouter", chave: CHAVE }, f)).ok).toBe(
      true,
    );
    expect(chamadas[0]?.url).toContain("/key");
  });
});

describe("URL do Ollama", () => {
  it("so hosts da lista", () => {
    expect(urlDoOllama("http://ollama:11434/qualquer", ["ollama"])).toBe(
      "http://ollama:11434",
    );
    expect(() => urlDoOllama("http://169.254.169.254/", ["ollama"])).toThrow(
      ErroDoProvedor,
    );
    expect(() => urlDoOllama("file:///etc/passwd", ["ollama"])).toThrow(ErroDoProvedor);
    expect(() => urlDoOllama("nao e url", ["ollama"])).toThrow(/inválida/);
  });
});

describe("modelo e classificacao", () => {
  it("cria modelo para todo provedor", () => {
    for (const provedor of NOMES_DE_PROVEDOR) {
      expect(criarModelo({ provedor, chave: CHAVE }, "m")).toBeTruthy();
    }
  });

  const base: ModeloListado = {
    id: "fora",
    nome: "fora",
    preco_entrada: null,
    preco_saida: null,
    ferramentas: null,
  };

  it("fora da lista e experimental, sem ferramentas e bloqueado", () => {
    expect(classificarModelo("deepseek", base).status).toBe("experimental");
    expect(classificarModelo("openrouter", { ...base, ferramentas: false }).status).toBe(
      "bloqueado",
    );
    expect(
      classificarModelo("ollama", { ...base, id: "deepseek-coder-v2:latest" }).status,
    ).toBe("bloqueado");
  });

  it("preco da lista versionada completa o do provedor", () => {
    const m = classificarModelo("deepseek", { ...base, id: "deepseek-flash" });
    expect(m.preco_entrada).toBe(0.3);
    expect(m.preco_saida).toBe(1.2);
  });
});
