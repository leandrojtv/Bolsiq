import { usuarioLogado } from "@/lib/auth";
import { editarTransacao, excluirTransacao } from "@/lib/carteira";
import { NovaTransacao } from "@/lib/carteira-modelo";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarCarteira } from "@/lib/respostas-carteira";

type Ctx = { params: Promise<{ id: string; transacao: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = NovaTransacao.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    const { id, transacao } = await ctx.params;
    await editarTransacao(u.id, id, transacao, r.data);
    return new Response(null, { status: 204 });
  } catch (erro) {
    return tratarCarteira(erro);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    const { id, transacao } = await ctx.params;
    await excluirTransacao(u.id, id, transacao);
    return new Response(null, { status: 204 });
  } catch (erro) {
    return tratarCarteira(erro);
  }
}
