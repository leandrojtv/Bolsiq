import { usuarioLogado } from "@/lib/auth";
import { lerJob } from "@/lib/importacao-ia";
import { naoAutenticado } from "@/lib/respostas";
import { tratarImportacaoIA } from "@/lib/respostas-importacao-ia";

/** Estado do job e dos arquivos, sem o conteudo. */
export async function GET(_req: Request, ctx: { params: Promise<{ job: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    return Response.json({ data: await lerJob(u.id, (await ctx.params).job) });
  } catch (e) {
    return tratarImportacaoIA(e);
  }
}
