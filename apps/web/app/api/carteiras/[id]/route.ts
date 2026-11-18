import { usuarioLogado } from "@/lib/auth";
import { painel } from "@/lib/carteira";
import { naoAutenticado } from "@/lib/respostas";
import { tratarCarteira } from "@/lib/respostas-carteira";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    return Response.json({ data: await painel(u.id, (await ctx.params).id) });
  } catch (erro) {
    return tratarCarteira(erro);
  }
}
