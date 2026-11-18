import WebSocket from "ws";
import { chaveInterna, urlDoStream } from "@/lib/market-data";

export const dynamic = "force-dynamic";

/**
 * Cotacao ao vivo por Server-Sent Events.
 *
 * O navegador nao fala com o /v1/stream direto: a chave ficaria no cliente. O
 * servidor abre o WebSocket com a chave e repassa so as mensagens de cotacao.
 * O cliente so assina com a aba visivel (componentes/ativo/useCotacaoAoVivo).
 */
export function GET(req: Request) {
  const tickers = (new URL(req.url).searchParams.get("t") ?? "")
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter((t) => /^[A-Z0-9]{4,12}$/.test(t))
    .slice(0, 20);
  if (tickers.length === 0) return new Response("informe ?t=", { status: 400 });

  const codificar = new TextEncoder();
  let ws: WebSocket | undefined;
  let pulso: ReturnType<typeof setInterval> | undefined;

  const corpo = new ReadableStream<Uint8Array>({
    start(controle) {
      const enviar = (texto: string) => {
        try {
          controle.enqueue(codificar.encode(texto));
        } catch {
          // Cliente ja foi embora.
        }
      };
      const chave = chaveInterna();
      ws = new WebSocket(urlDoStream(), chave ? { headers: { "x-api-key": chave } } : {});
      ws.on("open", () => ws?.send(JSON.stringify({ action: "subscribe", tickers })));
      ws.on("message", (dados: Buffer) => {
        const texto = dados.toString();
        if (texto.includes('"type":"quote"')) enviar(`data: ${texto}\n\n`);
      });
      ws.on("close", () => {
        try {
          controle.close();
        } catch {
          // ja fechado
        }
      });
      ws.on("error", () => ws?.close());
      // Comentario SSE a cada 25 s: proxies fecham conexao parada.
      pulso = setInterval(() => enviar(": pulso\n\n"), 25_000);
      req.signal.addEventListener("abort", () => {
        clearInterval(pulso);
        ws?.close();
      });
    },
    cancel() {
      clearInterval(pulso);
      ws?.close();
    },
  });

  return new Response(corpo, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
