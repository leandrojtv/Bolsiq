import { PagamentoDeFatura } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";
import { pagar } from "@/lib/financas";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; fatura: string }> },
) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = PagamentoDeFatura.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    const p = await ctx.params;
    return Response.json({ data: await pagar(u.id, p.id, p.fatura, r.data) });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
