import { usuarioLogado } from "@/lib/auth";
import { adicionarTransacao } from "@/lib/carteira";
import { NovaTransacao } from "@/lib/carteira-modelo";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarCarteira } from "@/lib/respostas-carteira";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = NovaTransacao.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    return Response.json(
      { data: await adicionarTransacao(u.id, (await ctx.params).id, r.data) },
      { status: 201 },
    );
  } catch (erro) {
    return tratarCarteira(erro);
  }
}
