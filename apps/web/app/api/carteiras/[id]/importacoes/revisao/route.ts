import { usuarioLogado } from "@/lib/auth";
import { revisarPosicao } from "@/lib/carteira";
import { naoAutenticado } from "@/lib/respostas";
import { tratarCarteira } from "@/lib/respostas-carteira";
import { erro, LIMITE_DE_ARQUIVO } from "../limites";

/** multipart: `arquivo` (CSV de posicoes). Compara com a carteira, sem gravar. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const form = await req.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  if (!(arquivo instanceof File)) return erro("Envie o arquivo CSV.");
  if (arquivo.size > LIMITE_DE_ARQUIVO) return erro("Arquivo acima de 5 MB.", 413);
  try {
    const revisao = await revisarPosicao(
      u.id,
      (await ctx.params).id,
      await arquivo.text(),
    );
    return Response.json({ data: revisao });
  } catch (e) {
    return tratarCarteira(e);
  }
}
