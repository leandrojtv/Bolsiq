import { EdicaoDeLancamento } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { mudarLancamento, removerLancamento } from "@/lib/financas";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = EdicaoDeLancamento.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    const { id } = await ctx.params;
    return Response.json({ data: await mudarLancamento(u.id, id, r.data) });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    const { id } = await ctx.params;
    await removerLancamento(u.id, id);
    return new Response(null, { status: 204 });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
