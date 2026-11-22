import { ParametroId } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";
import { removerDivida } from "@/lib/financas";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const p = ParametroId.safeParse(await ctx.params);
  if (!p.success) return invalido(p.error);
  try {
    return Response.json({ data: await removerDivida(u.id, p.data.id) });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
