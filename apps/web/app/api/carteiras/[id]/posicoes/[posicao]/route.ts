import { usuarioLogado } from "@/lib/auth";
import { editarPosicao, excluirPosicao } from "@/lib/carteira";
import { EdicaoDePosicao } from "@/lib/carteira-modelo";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarCarteira } from "@/lib/respostas-carteira";

type Ctx = { params: Promise<{ id: string; posicao: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = EdicaoDePosicao.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    const { id, posicao } = await ctx.params;
    await editarPosicao(u.id, id, posicao, r.data);
    return new Response(null, { status: 204 });
  } catch (erro) {
    return tratarCarteira(erro);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    const { id, posicao } = await ctx.params;
    await excluirPosicao(u.id, id, posicao);
    return new Response(null, { status: 204 });
  } catch (erro) {
    return tratarCarteira(erro);
  }
}
