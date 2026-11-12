import { usuarioLogado } from "@/lib/auth";
import { reprocessarArquivo } from "@/lib/importacao-ia";
import { PedidoDeReprocessamento } from "@/lib/importacao-ia-modelo";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarImportacaoIA } from "@/lib/respostas-importacao-ia";

/** JSON: `indice` do arquivo, `lotes` (os que falharam) ou `modelo` (outro modelo). */
export async function POST(req: Request, ctx: { params: Promise<{ job: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const corpo = PedidoDeReprocessamento.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return invalido(corpo.error);
  try {
    await reprocessarArquivo(u.id, (await ctx.params).job, corpo.data.indice, {
      ...(corpo.data.lotes ? { lotes: corpo.data.lotes } : {}),
      ...(corpo.data.modelo ? { modelo: corpo.data.modelo } : {}),
    });
    return new Response(null, { status: 202 });
  } catch (e) {
    return tratarImportacaoIA(e);
  }
}
