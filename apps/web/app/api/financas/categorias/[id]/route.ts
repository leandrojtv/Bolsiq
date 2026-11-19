import { EdicaoDeCategoria } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { mudarCategoria, removerCategoria } from "@/lib/financas";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = EdicaoDeCategoria.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    const { id } = await ctx.params;
    return Response.json({ data: await mudarCategoria(u.id, id, r.data) });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    const { id } = await ctx.params;
    await removerCategoria(u.id, id);
    return new Response(null, { status: 204 });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
