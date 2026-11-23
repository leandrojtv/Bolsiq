import { usuarioLogado } from "@/lib/auth";
import { lerLeitura } from "@/lib/financas-leitura";
import { confirmarCustoDoJob } from "@/lib/importacao-ia";
import { naoAutenticado } from "@/lib/respostas";
import { tratarLeitura } from "@/lib/respostas-leitura";

/** O usuario aceita o custo estimado acima do limite: a leitura segue. */
export async function POST(_req: Request, ctx: { params: Promise<{ job: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    const job = (await ctx.params).job;
    await lerLeitura(u.id, job);
    await confirmarCustoDoJob(u.id, job);
    return new Response(null, { status: 204 });
  } catch (e) {
    return tratarLeitura(e);
  }
}
