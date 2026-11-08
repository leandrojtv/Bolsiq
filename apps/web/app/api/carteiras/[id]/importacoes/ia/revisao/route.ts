import { usuarioLogado } from "@/lib/auth";
import { revisarImportacaoIA } from "@/lib/importacao-ia";
import { PedidoDeRevisaoIA } from "@/lib/importacao-ia-modelo";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarImportacaoIA } from "@/lib/respostas-importacao-ia";

/** JSON: `extracao_id` e as linhas marcadas, editadas. A revisao de sempre, sem gravar. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const corpo = PedidoDeRevisaoIA.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return invalido(corpo.error);
  try {
    const revisao = await revisarImportacaoIA(
      u.id,
      (await ctx.params).id,
      corpo.data.extracao_id,
      corpo.data.linhas,
    );
    return Response.json({ data: revisao });
  } catch (e) {
    return tratarImportacaoIA(e);
  }
}
