import { listarConversas } from "@/lib/assistente";
import { usuarioLogado } from "@/lib/auth";
import { naoAutenticado } from "@/lib/respostas";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  return Response.json({ data: await listarConversas(u.id) });
}
