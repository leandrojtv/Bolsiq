import { configurarRelatorio, estadoDoAssistente } from "@/lib/assistente";
import { PedidoDoRelatorio } from "@/lib/assistente-modelo";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarAssistente } from "@/lib/respostas-assistente";

/** Liga ou desliga o relatorio mensal (opt-in; gasta tokens do usuario). */
export async function PUT(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = PedidoDoRelatorio.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    await configurarRelatorio(u.id, r.data.ligado);
    return Response.json({ data: await estadoDoAssistente(u.id) });
  } catch (erro) {
    return tratarAssistente(erro);
  }
}
