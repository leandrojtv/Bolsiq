import { usuarioLogado } from "@/lib/auth";
import { lerResultadoDoArquivo } from "@/lib/importacao-ia";
import { naoAutenticado } from "@/lib/respostas";
import { tratarImportacaoIA } from "@/lib/respostas-importacao-ia";

/** O resultado de um arquivo para a revisao: linhas, conciliacao e texto das paginas. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ job: string; indice: string }> },
) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const { job, indice } = await ctx.params;
  try {
    return Response.json({
      data: await lerResultadoDoArquivo(u.id, job, Number(indice)),
    });
  } catch (e) {
    return tratarImportacaoIA(e);
  }
}
