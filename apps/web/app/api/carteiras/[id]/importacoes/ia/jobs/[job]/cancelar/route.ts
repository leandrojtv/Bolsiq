import { usuarioLogado } from "@/lib/auth";
import { cancelarJob } from "@/lib/importacao-ia";
import { naoAutenticado } from "@/lib/respostas";
import { tratarImportacaoIA } from "@/lib/respostas-importacao-ia";

/** Cancela o job; o worker para no proximo lote, e os arquivos saem do servidor. */
export async function POST(_req: Request, ctx: { params: Promise<{ job: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    await cancelarJob(u.id, (await ctx.params).job);
    return new Response(null, { status: 204 });
  } catch (e) {
    return tratarImportacaoIA(e);
  }
}
