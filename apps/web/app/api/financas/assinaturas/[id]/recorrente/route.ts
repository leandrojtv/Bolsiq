import { ParametroDoInsight } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";
import { assinaturaRecorrente } from "@/lib/financas";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const p = ParametroDoInsight.safeParse(await ctx.params);
  if (!p.success) return invalido(p.error);
  try {
    return Response.json(
      { data: await assinaturaRecorrente(u.id, p.data.id) },
      { status: 201 },
    );
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
