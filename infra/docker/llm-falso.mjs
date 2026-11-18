// Provedor de IA falso para o e2e: fala o protocolo compativel com OpenAI e o do
// Ollama. Chama a ferramenta certa para cada pergunta e responde com os numeros
// que a ferramenta devolveu, sem inventar. Anota a chave que recebeu, para o e2e
// conferir que ela chegou ao provedor (e so a ele).
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const CHAVE_ACEITA = "sk-e2e-chave-de-teste-do-bolsiq-1234";
// deepseek-flash tem saida estruturada em modelos.json: e o modelo do e2e da importacao.
const MODELOS = ["falso-com-ferramentas", "falso-sem-ferramentas", "deepseek-flash"];

/**
 * Importacao com IA: respostas gravadas, por um trecho do documento
 * (infra/docker/llm-falso-importacao.json, gerado das fixtures do eval). O
 * cabecalho vem em JSON (saida estruturada, ou bloco ```json no fallback) e as
 * linhas em blocos CSV, como o modelo de verdade responde.
 */
function respostaDaImportacao(corpo) {
  let gravadas = {};
  try {
    gravadas = JSON.parse(readFileSync("/llm-falso-importacao.json", "utf8"));
  } catch {
    // Sem o arquivo montado, nao ha importacao a responder.
  }
  const texto = JSON.stringify(corpo.messages);
  const achada = Object.entries(gravadas).find(([marcador]) =>
    texto.includes(marcador),
  )?.[1];
  const cabecalho = achada?.cabecalho ?? {
    tipo: "misto",
    corretora: "",
    data_referencia: "",
    totais_declarados: [],
    avisos: ["Documento desconhecido pelo provedor falso."],
  };
  if (corpo.response_format) return JSON.stringify(cabecalho);
  if (texto.includes("leia só o cabeçalho"))
    return `\`\`\`json\n${JSON.stringify(cabecalho)}\n\`\`\``;
  return achada?.csv ?? "";
}

let ultimaAutorizacao = null;

const ferramentaDa = (texto) => {
  const t = texto.toLowerCase();
  if (t.includes("avalie")) return ["avaliar_carteira", {}];
  if (t.includes("aportar")) return ["sugerir_aporte", { valor: 1000 }];
  if (t.includes("alerta"))
    return ["criar_alerta", { ticker: "PETR4", tipo: "preco_acima", valor: 40 }];
  return null;
};

function respostaFinal(ferramenta, saida) {
  if (ferramenta === "avaliar_carteira") {
    const a = saida.concentracao?.por_ativo ?? [];
    const d = saida.desvio_da_alocacao ?? [];
    return [
      "Concentração:",
      ...a.map((l) => `- ${l.chave}: ${(l.fracao * 100).toFixed(2)}%`),
      "Desvio da alocação-alvo:",
      ...d.map(
        (l) =>
          `- ${l.classe}: atual ${(l.atual * 100).toFixed(2)}%, alvo ${(l.alvo * 100).toFixed(2)}%`,
      ),
      `Risco: volatilidade ${saida.risco?.volatilidade_anual ?? "sem dado"}.`,
    ].join("\n");
  }
  if (ferramenta === "sugerir_aporte") {
    if (saida.erro) return `Sem candidatos: ${saida.mensagem}`;
    const linhas = saida.classes.flatMap((c) =>
      c.candidatos.map(
        (x) =>
          `- ${x.ticker}: score ${x.score}; critérios ${x.metodos.join(", ")}; riscos: ${x.riscos.join("; ") || "nenhum apontado"}`,
      ),
    );
    return [
      "Candidatos:",
      ...linhas,
      ...saida.classes.flatMap((c) => (c.sem_candidatos ? [c.sem_candidatos] : [])),
    ].join("\n");
  }
  if (ferramenta === "criar_alerta")
    return "Preparei o alerta. Confirme na tela para criá-lo.";
  return "Consulta feita.";
}

const sse = (res, corpo, modelo) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const pedaco = (delta, fim = null, extra = {}) =>
    res.write(
      `data: ${JSON.stringify({
        id: "falso",
        object: "chat.completion.chunk",
        created: 1,
        model: modelo,
        choices: [{ index: 0, delta, finish_reason: fim }],
        ...extra,
      })}\n\n`,
    );
  pedaco({ role: "assistant", content: "" });
  corpo(pedaco);
  res.write(
    `data: ${JSON.stringify({
      id: "falso",
      object: "chat.completion.chunk",
      created: 1,
      model: modelo,
      choices: [],
      usage: { prompt_tokens: 1200, completion_tokens: 80, total_tokens: 1280 },
    })}\n\n`,
  );
  res.end("data: [DONE]\n\n");
};

function ler(req) {
  return new Promise((ok) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => ok(b));
  });
}

createServer(async (req, res) => {
  const json = (s, v) => {
    res.writeHead(s, { "content-type": "application/json" });
    res.end(JSON.stringify(v));
  };
  const url = req.url ?? "";
  if (url === "/saude") return json(200, { ok: true });
  if (url === "/ultima-autorizacao") return json(200, { autorizacao: ultimaAutorizacao });
  if (url === "/api/tags")
    return json(200, { models: MODELOS.map((name) => ({ name })) });
  if (url === "/api/show") {
    const { model } = JSON.parse(await ler(req));
    return json(200, {
      capabilities:
        model === "falso-sem-ferramentas" ? ["completion"] : ["completion", "tools"],
    });
  }

  // Protocolo compativel: a chave errada recebe 401, com a chave de volta no
  // erro, como alguns provedores fazem. E o teste de vazamento.
  const autorizacao = req.headers.authorization ?? null;
  const exige = !url.startsWith("/v1/");
  if (exige) {
    ultimaAutorizacao = autorizacao;
    if (autorizacao !== `Bearer ${CHAVE_ACEITA}`)
      return json(401, {
        error: { message: `Incorrect API key provided: ${autorizacao}` },
      });
  }
  if (url.endsWith("/models")) return json(200, { data: MODELOS.map((id) => ({ id })) });
  if (url.endsWith("/chat/completions")) {
    const corpo = JSON.parse(await ler(req));
    const { messages, model } = corpo;
    // Sem stream: e a importacao com IA (generateObject e generateText).
    if (corpo.stream !== true)
      return json(200, {
        id: "falso",
        object: "chat.completion",
        created: 1,
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: respostaDaImportacao(corpo),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 4200, completion_tokens: 1800, total_tokens: 6000 },
      });
    const ultimaFerramenta = [...messages].reverse().find((m) => m.role === "tool");
    const ultimaPergunta = [...messages].reverse().find((m) => m.role === "user");
    const respondidas =
      messages.lastIndexOf(ultimaPergunta) < messages.indexOf(ultimaFerramenta);
    if (ultimaFerramenta && respondidas) {
      const chamada = messages
        .flatMap((m) => m.tool_calls ?? [])
        .find((c) => c.id === ultimaFerramenta.tool_call_id);
      const texto = respostaFinal(
        chamada?.function.name,
        JSON.parse(ultimaFerramenta.content),
      );
      return sse(
        res,
        (p) => {
          p({ content: texto });
          p({}, "stop");
        },
        model,
      );
    }
    const alvo = ferramentaDa(String(ultimaPergunta?.content ?? ""));
    if (!alvo)
      return sse(
        res,
        (p) => {
          p({ content: "Sem acesso a esse dado." });
          p({}, "stop");
        },
        model,
      );
    return sse(
      res,
      (p) => {
        p({
          tool_calls: [
            {
              index: 0,
              id: "chamada-1",
              type: "function",
              function: { name: alvo[0], arguments: JSON.stringify(alvo[1]) },
            },
          ],
        });
        p({}, "tool_calls");
      },
      model,
    );
  }
  return json(404, { error: { message: "rota desconhecida" } });
}).listen(11434, "0.0.0.0");
