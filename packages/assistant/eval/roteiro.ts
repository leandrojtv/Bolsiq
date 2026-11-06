import { simulateReadableStream, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { CARTEIRA_ID } from "./base.js";
import type { Caso } from "./casos.js";

const USO = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

const reais = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2 });

/** Primeiro parametro valido para a ferramenta quando o caso nao diz qual. */
const ENTRADA_PADRAO: Record<string, Record<string, unknown>> = {
  cotacao: { tickers: ["PETR4", "VALE3"] },
  historico: { ticker: "VALE3" },
  proventos: { ticker: "VALE3" },
  fundamentos: { ticker: "PETR4" },
  comparar: { tickers: ["PETR4", "PRIO3"] },
  minha_carteira: {},
  avaliar_carteira: {},
  sugerir_aporte: { valor: 1000 },
};

const CARTEIRA_ERRADA = "00000000-0000-4000-8000-000000000000";

interface MensagemDeFerramenta {
  role: string;
  content: {
    type: string;
    output?: { value?: { tickers_permitidos?: string[]; erro?: string } };
  }[];
}

/** Texto que atende o caso, a partir do resultado real das ferramentas. */
function respostaDoCaso(caso: Caso, prompt: MensagemDeFerramenta[]): string {
  const saidas = prompt
    .filter((m) => m.role === "tool")
    .flatMap((m) => m.content.map((c) => c.output?.value));
  const permitidos = saidas.flatMap((s) => s?.tickers_permitidos ?? []);
  const partes = [
    ...(caso.numeros ?? []).map((n) => reais(n)),
    ...permitidos,
    ...(caso.deve_conter ?? []).map((re) => textoQueCasa(re)),
  ];
  return partes.join(" - ") || "Consulta feita.";
}

/** Um texto fixo por expressao esperada: o roteiro nao testa redacao. */
function textoQueCasa(re: RegExp): string {
  const fonte = re.source;
  if (fonte.includes("bilh")) return "37 bilhões";
  if (fonte.includes("encontr") && fonte.includes("tenho")) return "não tenho esse dado";
  if (fonte.includes("not[ií]cias")) return "notícias";
  if (fonte.includes("sem acesso")) return "sem acesso";
  return fonte.replace(/[\\^$.*+?()[\]{}|/]/g, "").replace(/[A-Z]{4}\d*/g, (t) => t);
}

/**
 * Modelo de mentira: chama as ferramentas que o caso espera e responde com os
 * valores esperados. Nao avalia modelo nenhum. Serve para exercitar o eval e as
 * ferramentas no CI: se o numero esperado nao bater com a saida real da
 * ferramenta, `numeros_sem_origem` reprova. Nunca homologa.
 */
export function modeloDeRoteiro(caso: Caso): LanguageModel {
  return new MockLanguageModelV4({
    provider: "roteiro",
    modelId: "roteiro",
    doStream: (opcoes) => {
      const prompt = opcoes.prompt as unknown as MensagemDeFerramenta[];
      const jaChamou = prompt.some((m) => m.role === "tool");
      const partes =
        jaChamou || caso.ferramentas.length === 0
          ? [
              { type: "text-start", id: "1" },
              { type: "text-delta", id: "1", delta: respostaDoCaso(caso, prompt) },
              { type: "text-end", id: "1" },
            ]
          : caso.ferramentas.map((f, i) => ({
              type: "tool-call",
              toolCallId: `c${i}`,
              toolName: f.nome,
              input: JSON.stringify(
                caso.id === "carteira-de-outro"
                  ? { id: CARTEIRA_ERRADA }
                  : caso.id === "carteira-por-id"
                    ? { id: CARTEIRA_ID }
                    : (f.parametros ?? ENTRADA_PADRAO[f.nome] ?? {}),
              ),
            }));
      return Promise.resolve({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            ...partes,
            {
              type: "finish",
              finishReason: {
                unified:
                  jaChamou || caso.ferramentas.length === 0 ? "stop" : "tool-calls",
                raw: undefined,
              },
              usage: USO,
            },
          ],
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }) as never,
      });
    },
  });
}
