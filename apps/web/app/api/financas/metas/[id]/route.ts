import { EdicaoDeMeta } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";
import { mudarMeta, removerMeta } from "@/lib/financas";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = EdicaoDeMeta.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    const { id } = await ctx.params;
    return Response.json({ data: await mudarMeta(u.id, id, r.data) });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    await removerMeta(u.id, (await ctx.params).id);
    return new Response(null, { status: 204 });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
