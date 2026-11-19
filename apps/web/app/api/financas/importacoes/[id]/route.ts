import { usuarioLogado } from "@/lib/auth";
import { importacao } from "@/lib/financas";
import { naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    return Response.json({ data: await importacao(u.id, (await ctx.params).id) });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
