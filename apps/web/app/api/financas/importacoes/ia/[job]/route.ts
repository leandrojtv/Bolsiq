import { usuarioLogado } from "@/lib/auth";
import { lerLeitura } from "@/lib/financas-leitura";
import { naoAutenticado } from "@/lib/respostas";
import { tratarLeitura } from "@/lib/respostas-leitura";

/** Estado da leitura e de cada arquivo, sem o conteudo. */
export async function GET(_req: Request, ctx: { params: Promise<{ job: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    return Response.json({ data: await lerLeitura(u.id, (await ctx.params).job) });
  } catch (e) {
    return tratarLeitura(e);
  }
}
