import { ParametroDeInsights, ParametroDoInsight } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";
import { insight } from "@/lib/financas";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const p = ParametroDoInsight.safeParse(await ctx.params);
  if (!p.success) return invalido(p.error);
  const q = ParametroDeInsights.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!q.success) return invalido(q.error);
  try {
    return Response.json({ data: await insight(u.id, p.data.id, q.data.mes) });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
