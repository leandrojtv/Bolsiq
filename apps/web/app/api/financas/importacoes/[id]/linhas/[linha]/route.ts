import { EdicaoDeLinha } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";
import { mudarLinha } from "@/lib/financas";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; linha: string }> },
) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = EdicaoDeLinha.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    const { id, linha } = await ctx.params;
    return Response.json({ data: await mudarLinha(u.id, id, linha, r.data) });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
