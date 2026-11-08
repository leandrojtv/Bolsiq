import { usuarioLogado } from "@/lib/auth";
import { confirmarImportacaoIA } from "@/lib/importacao-ia";
import { PedidoDeConfirmacaoIA } from "@/lib/importacao-ia-modelo";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarImportacaoIA } from "@/lib/respostas-importacao-ia";

/**
 * JSON: `extracao_id`, as linhas que o usuario confirmou, `decisoes` das
 * divergencias e `aceitar_nao_conciliada`. Unico ponto que grava.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const corpo = PedidoDeConfirmacaoIA.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return invalido(corpo.error);
  if (corpo.data.linhas.length === 0)
    return Response.json(
      { error: { code: "validation_error", message: "Marque ao menos uma linha." } },
      { status: 422 },
    );
  try {
    const relatorio = await confirmarImportacaoIA(
      u.id,
      (await ctx.params).id,
      corpo.data,
    );
    return Response.json({ data: relatorio }, { status: 201 });
  } catch (e) {
    return tratarImportacaoIA(e);
  }
}
