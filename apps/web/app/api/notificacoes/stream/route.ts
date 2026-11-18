import { subjectInApp } from "@bolsiq/alerts";
import { naoLidasDe } from "@/lib/alertas";
import { nats } from "@/lib/nats";
import { usuarioAtual } from "@/lib/usuario";

export const dynamic = "force-dynamic";

/**
 * Sino em tempo real: o servidor assina alerts.inapp.<user_id> no NATS core e
 * repassa por Server-Sent Events. O navegador nao fala com o NATS, e so recebe
 * o proprio subject, porque o id vem do cookie, nao de parametro.
 *
 * Abre com o contador atual: aviso perdido enquanto a aba estava fechada nao
 * deixa o sino errado.
 */
export async function GET(req: Request) {
  const uid = await usuarioAtual();
  const nc = await nats();
  const assinatura = nc.subscribe(subjectInApp(uid));
  const codificar = new TextEncoder();
  let pulso: ReturnType<typeof setInterval> | undefined;

  const corpo = new ReadableStream<Uint8Array>({
    async start(controle) {
      const enviar = (evento: string, dados: unknown) => {
        try {
          controle.enqueue(
            codificar.encode(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`),
          );
        } catch {
          // Cliente ja foi embora.
        }
      };
      enviar("contador", { nao_lidas: await naoLidasDe(uid) });
      pulso = setInterval(() => {
        try {
          controle.enqueue(codificar.encode(": pulso\n\n"));
        } catch {
          // fechado
        }
      }, 25_000);
      req.signal.addEventListener("abort", () => {
        clearInterval(pulso);
        assinatura.unsubscribe();
      });
      for await (const m of assinatura) {
        const aviso = JSON.parse(new TextDecoder().decode(m.data)) as {
          id: string;
          titulo: string;
          corpo: string;
        };
        enviar("notificacao", { ...aviso, nao_lidas: await naoLidasDe(uid) });
      }
    },
    cancel() {
      clearInterval(pulso);
      assinatura.unsubscribe();
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
