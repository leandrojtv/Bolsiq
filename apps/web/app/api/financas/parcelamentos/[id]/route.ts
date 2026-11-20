import { usuarioLogado } from "@/lib/auth";
import { plano, removerPlano } from "@/lib/financas";
import { naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    return Response.json({ data: await plano(u.id, (await ctx.params).id) });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    await removerPlano(u.id, (await ctx.params).id);
    return new Response(null, { status: 204 });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
