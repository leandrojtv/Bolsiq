import "server-only";
import { env } from "./env";

export interface RespostaV1<T> {
  status: number;
  corpo: T;
}

/** Validade do cache do servidor por tipo de dado, em segundos. */
export const VALIDADE = {
  assets: 3600,
  quotes: 15,
  history: 300,
  dividends: 3600,
  fundamentals: 3600,
  macro: 3600,
} as const;

/**
 * Chamada ao /v1 do market-data, so no servidor.
 *
 * A chave vai no header X-API-Key a partir daqui. Hoje sem o Kong o
 * market-data nao a exige; quando o gateway entrar (ADR 0007), muda so a
 * MARKET_DATA_URL.
 */
export async function buscarV1<T>(
  caminho: string,
  validade: number,
): Promise<RespostaV1<T>> {
  const res = await fetch(`${env.MARKET_DATA_URL}/v1/${caminho}`, {
    headers: env.MARKET_DATA_API_KEY ? { "x-api-key": env.MARKET_DATA_API_KEY } : {},
    next: { revalidate: validade },
    signal: AbortSignal.timeout(15_000),
  });
  const corpo = (await res.json().catch(() => null)) as T;
  return { status: res.status, corpo };
}

/** Caminhos do /v1 que o navegador pode pedir pelo BFF, e a validade de cada um. */
const PERMITIDOS: [RegExp, number][] = [
  [/^assets$/, VALIDADE.assets],
  [/^assets\/[A-Za-z0-9]{4,12}$/, VALIDADE.assets],
  [/^quotes\/[A-Za-z0-9,]{4,260}$/, VALIDADE.quotes],
  [/^history\/[A-Za-z0-9]{4,12}$/, VALIDADE.history],
  [/^dividends\/[A-Za-z0-9]{4,12}$/, VALIDADE.dividends],
  [/^fundamentals\/[A-Za-z0-9]{4,12}$/, VALIDADE.fundamentals],
  [/^macro\/[a-z]{2,8}$/, VALIDADE.macro],
  [/^funds$/, VALIDADE.assets],
  [/^funds\/\d{14}$/, VALIDADE.assets],
  [/^funds\/\d{14}\/history$/, VALIDADE.history],
];

/** Validade do caminho, ou `null` se o BFF nao repassa (admin, por exemplo). */
export function validadeDe(caminho: string): number | null {
  for (const [re, v] of PERMITIDOS) if (re.test(caminho)) return v;
  return null;
}

export function urlDoStream(): string {
  return `${env.MARKET_DATA_URL.replace(/^http/, "ws")}/v1/stream`;
}

export function chaveInterna(): string | undefined {
  return env.MARKET_DATA_API_KEY;
}
