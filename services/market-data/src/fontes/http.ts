import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BolsiqError } from "@bolsiq/contracts";

/** `fetch` injetavel: o teste passa um falso e nao toca a rede. */
export type Buscar = (url: string, init?: RequestInit) => Promise<Response>;

export interface ArquivoBaixado {
  caminho: string;
  bytes: number;
  sha256: string;
}

const USER_AGENT = "bolsiq-market-data/0.1 (+https://github.com/leandrojtv/Bolsiq)";

/**
 * GET com prazo. Erro de rede ou 5xx vira `source_unavailable`, para a rota
 * responder 503 em vez de 500: a falha e da fonte, nao nossa.
 */
export async function obter(
  buscar: Buscar,
  url: string,
  opcoes: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<Response> {
  try {
    const res = await buscar(url, {
      headers: { "user-agent": USER_AGENT, ...opcoes.headers },
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? 15_000),
    });
    if (res.status >= 500) {
      throw new BolsiqError("source_unavailable", `fonte respondeu ${res.status}`, {
        url,
      });
    }
    return res;
  } catch (erro) {
    if (erro instanceof BolsiqError) throw erro;
    throw new BolsiqError("source_unavailable", "fonte inalcancavel", {
      url,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
  }
}

/**
 * Baixa para arquivo temporario calculando o hash no caminho.
 *
 * Os ZIPs da CVM e da B3 passam de 600 MB descomprimidos: nada aqui carrega o
 * arquivo inteiro em memoria. `null` quando a fonte responde 404, que no
 * COTAHIST diario significa feriado, nao erro.
 */
export async function baixarParaArquivo(
  buscar: Buscar,
  url: string,
  timeoutMs = 600_000,
): Promise<ArquivoBaixado | null> {
  const res = await obter(buscar, url, { timeoutMs });
  if (res.status === 404) return null;
  if (!res.ok || !res.body) {
    throw new BolsiqError("source_unavailable", `download falhou com ${res.status}`, {
      url,
    });
  }

  const pasta = await mkdtemp(join(tmpdir(), "bolsiq-"));
  const caminho = join(pasta, url.split("/").pop() ?? "arquivo");
  const hash = createHash("sha256");
  let bytes = 0;

  const corpo = Readable.fromWeb(res.body);
  corpo.on("data", (parte: Buffer) => {
    hash.update(parte);
    bytes += parte.length;
  });
  await pipeline(corpo, createWriteStream(caminho));

  return { caminho, bytes, sha256: hash.digest("hex") };
}
