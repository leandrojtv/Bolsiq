import { usuarioLogado } from "@/lib/auth";
import { fatura } from "@/lib/financas";
import { naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; fatura: string }> },
) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    const p = await ctx.params;
    return Response.json({ data: await fatura(u.id, p.id, p.fatura) });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
