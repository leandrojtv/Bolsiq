import { usuarioLogado } from "@/lib/auth";
import { lerJob } from "@/lib/importacao-ia";
import { TERMINAIS } from "@/lib/importacao-ia-modelo";
import { naoAutenticado } from "@/lib/respostas";
import { tratarImportacaoIA } from "@/lib/respostas-importacao-ia";

export const dynamic = "force-dynamic";

/** Um evento por mudanca de estado; quieto, um comentario a cada 15 s. */
const INTERVALO_MS = 1_000;
const BATIMENTO_MS = 15_000;
/** O navegador reconecta sozinho (EventSource); a conexao nao fica aberta para sempre. */
const DURACAO_MS = 10 * 60_000;

/**
 * SSE do progresso: le o estado gravado pelo worker e manda quando muda (etapa,
 * lote n de N, linhas extraidas). Fecha quando o job termina.
 */
export async function GET(req: Request, ctx: { params: Promise<{ job: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const id = (await ctx.params).job;
  try {
    await lerJob(u.id, id);
  } catch (e) {
    return tratarImportacaoIA(e);
  }
  const codificar = new TextEncoder();
  const corpo = new ReadableStream<Uint8Array>({
    async start(controle) {
      const inicio = Date.now();
      let anterior = "";
      let batimento = Date.now();
      try {
        while (!req.signal.aborted && Date.now() - inicio < DURACAO_MS) {
          const job = await lerJob(u.id, id);
          const atual = JSON.stringify(job);
          if (atual !== anterior) {
            controle.enqueue(codificar.encode(`data: ${atual}\n\n`));
            anterior = atual;
            batimento = Date.now();
          } else if (Date.now() - batimento > BATIMENTO_MS) {
            controle.enqueue(codificar.encode(": ainda aqui\n\n"));
            batimento = Date.now();
          }
          if (TERMINAIS.includes(job.status)) break;
          await new Promise((r) => setTimeout(r, INTERVALO_MS));
        }
      } catch {
        // Job apagado (exclusao da conta) ou banco fora: fecha, a tela tenta de novo.
      }
      controle.close();
    },
  });
  return new Response(corpo, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}
