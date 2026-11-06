import type { ModelMessage } from "ai";

/** Teto por chamada ao modelo (requisito). A margem cobre o erro da estimativa. */
export const LIMITE_DE_TOKENS = 100_000;
export const ORCAMENTO_DE_ENTRADA = 80_000;
/** Resposta de ferramenta acima disto e cortada antes de ir ao modelo. */
export const MAX_CARACTERES_DA_FERRAMENTA = 24_000;
/** Mensagens antigas que ainda entram no historico. */
export const MAX_MENSAGENS_NO_HISTORICO = 20;

/** Estimativa conservadora: cerca de 3,5 caracteres por token em portugues e JSON. */
export const estimarTokens = (texto: string): number => Math.ceil(texto.length / 3.5);

export const tokensDaMensagem = (m: ModelMessage): number =>
  estimarTokens(JSON.stringify(m.content));

/**
 * Mantem o historico dentro do orcamento: tira as mensagens mais antigas, nunca
 * a ultima. Nao resume com o modelo, para nao gastar token nem inventar numero:
 * numero antigo o assistente busca de novo pela ferramenta.
 */
export function limitarMensagens<M extends ModelMessage>(
  mensagens: M[],
  sistema: string,
  orcamento = ORCAMENTO_DE_ENTRADA,
): M[] {
  let total = estimarTokens(sistema);
  const mantidas: M[] = [];
  for (const m of [...mensagens].reverse()) {
    total += tokensDaMensagem(m);
    if (total > orcamento && mantidas.length > 0) break;
    mantidas.unshift(m);
  }
  // Historico nao pode comecar com resposta de ferramenta orfa.
  while (mantidas.length > 1 && mantidas[0]?.role === "tool") mantidas.shift();
  return mantidas;
}

/** Corta o JSON grande de ferramenta, avisando o modelo do corte. */
export function limitarSaida<T>(saida: T): T | { truncado: true; parcial: string } {
  const texto = JSON.stringify(saida);
  if (texto.length <= MAX_CARACTERES_DA_FERRAMENTA) return saida;
  return { truncado: true, parcial: texto.slice(0, MAX_CARACTERES_DA_FERRAMENTA) };
}

export interface Uso {
  tokens_entrada: number;
  tokens_saida: number;
}

/** Custo em dolares, com preco por milhao. Sem preco conhecido, nulo, nao zero. */
export function custoEstimado(
  uso: Uso,
  preco: { entrada: number | null; saida: number | null },
): string | null {
  if (preco.entrada === null || preco.saida === null) return null;
  const custo =
    (uso.tokens_entrada * preco.entrada + uso.tokens_saida * preco.saida) / 1_000_000;
  return custo.toFixed(6);
}
