import { PedidoDeAmortizacao } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";
import { amortizarDivida } from "@/lib/financas";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = PedidoDeAmortizacao.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    const { id } = await ctx.params;
    return Response.json({ data: await amortizarDivida(u.id, id, r.data) });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
