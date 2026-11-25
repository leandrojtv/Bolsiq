import { usuarioLogado } from "@/lib/auth";
import { lerLeitura } from "@/lib/financas-leitura";
import { cancelarJob } from "@/lib/importacao-ia";
import { naoAutenticado } from "@/lib/respostas";
import { tratarLeitura } from "@/lib/respostas-leitura";

/** Cancela a leitura; o worker para no proximo lote, e os arquivos saem do servidor. */
export async function POST(_req: Request, ctx: { params: Promise<{ job: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    const job = (await ctx.params).job;
    await lerLeitura(u.id, job);
    await cancelarJob(u.id, job);
    return new Response(null, { status: 204 });
  } catch (e) {
    return tratarLeitura(e);
  }
}
