import { EdicaoDeConta } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { mudarConta, removerConta } from "@/lib/financas";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = EdicaoDeConta.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    const { id } = await ctx.params;
    return Response.json({ data: await mudarConta(u.id, id, r.data) });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    const { id } = await ctx.params;
    await removerConta(u.id, id);
    return new Response(null, { status: 204 });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
