import { z } from "zod";

/**
 * Protocolo do `/v1/stream`.
 *
 * Deliberadamente mínimo e em JSON: o cliente é o navegador, e o formato tem de
 * ser óbvio sem SDK.
 */
export const ComandoDoCliente = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("subscribe"),
    tickers: z.array(z.string()).min(1).max(500),
  }),
  z.object({
    action: z.literal("unsubscribe"),
    tickers: z.array(z.string()).min(1).max(500),
  }),
  z.object({ action: z.literal("ping") }),
]);

export type ComandoDoCliente = z.infer<typeof ComandoDoCliente>;

export function analisarComando(
  bruto: string,
): { ok: true; comando: ComandoDoCliente } | { ok: false; erro: string } {
  let json: unknown;
  try {
    json = JSON.parse(bruto);
  } catch {
    return { ok: false, erro: "mensagem não é JSON" };
  }

  const resultado = ComandoDoCliente.safeParse(json);
  if (!resultado.success) {
    const primeiro = resultado.error.issues[0];
    return {
      ok: false,
      erro: primeiro
        ? `${primeiro.path.join(".") || "action"}: ${primeiro.message}`
        : "comando inválido",
    };
  }

  return { ok: true, comando: resultado.data };
}

export function mensagemDeCotacao(payload: {
  ticker: string;
  price: string;
  change: string;
  ts: string;
}): string {
  return JSON.stringify({ type: "quote", ...payload });
}

export function mensagemDeErro(erro: string): string {
  return JSON.stringify({ type: "error", message: erro });
}

export function mensagemDeAssinatura(
  acao: "subscribed" | "unsubscribed",
  tickers: string[],
  rejeitados: { ticker: string; motivo: string }[] = [],
): string {
  return JSON.stringify({
    type: acao,
    tickers,
    ...(rejeitados.length > 0 ? { rejected: rejeitados } : {}),
  });
}
