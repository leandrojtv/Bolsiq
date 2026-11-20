import { usuarioLogado } from "@/lib/auth";
import { comprometido } from "@/lib/financas";
import { naoAutenticado } from "@/lib/respostas";

export async function GET() {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  return Response.json({ data: await comprometido(u.id) });
}
