import { usuarioLogado } from "@/lib/auth";
import { confirmarCustoDoJob } from "@/lib/importacao-ia";
import { naoAutenticado } from "@/lib/respostas";
import { tratarImportacaoIA } from "@/lib/respostas-importacao-ia";

/** O usuario aceita o custo estimado acima do limite: o job segue. */
export async function POST(_req: Request, ctx: { params: Promise<{ job: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    await confirmarCustoDoJob(u.id, (await ctx.params).job);
    return new Response(null, { status: 204 });
  } catch (e) {
    return tratarImportacaoIA(e);
  }
}
