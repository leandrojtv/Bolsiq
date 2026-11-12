import type { AssetSummary, LiveQuote, ResponseMeta } from "@bolsiq/contracts";

/** Cliente do BFF no navegador. So /api: a chave nunca sai do servidor. */
export class ErroDaApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    readonly correlationId?: string,
    /** O `error.code` do BFF, para a tela decidir (precisa_senha, por exemplo). */
    readonly codigo?: string,
  ) {
    super(mensagem);
  }
}

export async function api<T>(caminho: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${caminho}`, init);
  const corpo = (await res.json().catch(() => null)) as
    (T & { error?: { message: string; correlation_id?: string; code?: string } }) | null;
  if (!res.ok) {
    throw new ErroDaApi(
      res.status,
      corpo?.error?.message ?? `erro ${res.status}`,
      corpo?.error?.correlation_id,
      corpo?.error?.code,
    );
  }
  return corpo as T;
}

export interface Envelope<T> {
  data: T;
  meta: ResponseMeta;
}

export const buscarAtivos = (q: string, signal?: AbortSignal) =>
  api<Envelope<AssetSummary[]>>(
    `v1/assets?q=${encodeURIComponent(q)}`,
    signal ? { signal } : {},
  );

export const buscarCotacoes = (tickers: string[]) =>
  api<Envelope<LiveQuote[]>>(`v1/quotes/${tickers.join(",")}`);
