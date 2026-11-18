import {
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { mensagemSegura } from "./chaves.js";
import { limitarMensagens } from "./orcamento.js";

export const MAX_PASSOS = 8;
export const MAX_TOKENS_DE_SAIDA = 4000;

export interface OpcoesDaConversa<T extends ToolSet> {
  modelo: LanguageModel;
  sistema: string;
  mensagens: ModelMessage[];
  ferramentas: T;
  /** Chave em uso: sai de qualquer texto de erro. */
  segredos: readonly string[];
  /** Erro ja limpo, unico caminho de erro de provedor para o log. */
  aoErrar?: (mensagem: string) => void;
  aoTerminar?: (uso: {
    tokens_entrada: number;
    tokens_saida: number;
  }) => void | Promise<void>;
  abortar?: AbortSignal;
}

/**
 * A chamada ao provedor, igual no BFF e no eval. Sem `telemetry` de proposito:
 * trace com os prompts levaria a carteira para fora do processo. `onError` e
 * obrigatorio: o padrao do AI SDK faz console.error do erro inteiro, com o corpo
 * da requisicao.
 */
export function conversar<T extends ToolSet>(o: OpcoesDaConversa<T>) {
  return streamText({
    model: o.modelo,
    system: o.sistema,
    messages: limitarMensagens(o.mensagens, o.sistema),
    tools: o.ferramentas,
    stopWhen: stepCountIs(MAX_PASSOS),
    maxOutputTokens: MAX_TOKENS_DE_SAIDA,
    maxRetries: 1,
    // Dentro do laco os resultados de ferramenta somam: o orcamento vale por chamada.
    prepareStep: ({ messages }) => ({ messages: limitarMensagens(messages, o.sistema) }),
    onError: ({ error }) => o.aoErrar?.(mensagemSegura(error, o.segredos)),
    onFinish: async ({ totalUsage }) => {
      await o.aoTerminar?.({
        tokens_entrada: totalUsage.inputTokens ?? 0,
        tokens_saida: totalUsage.outputTokens ?? 0,
      });
    },
    ...(o.abortar ? { abortSignal: o.abortar } : {}),
  });
}
