import { MODULOS_DO_ASSISTENTE } from "@bolsiq/assistant/puro";
import { listarConversas } from "@/lib/assistente";
import { usuarioLogado } from "@/lib/auth";
import { naoAutenticado } from "@/lib/respostas";

export const dynamic = "force-dynamic";

/** `?modulo=financas`: so as conversas daquele modulo. */
export async function GET(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const pedido = new URL(req.url).searchParams.get("modulo");
  const modulo = MODULOS_DO_ASSISTENTE.find((m) => m === pedido);
  return Response.json({ data: await listarConversas(u.id, modulo) });
}
