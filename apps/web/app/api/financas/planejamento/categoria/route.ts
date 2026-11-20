import { ValorDaCategoria } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";
import { valorDaCategoria } from "@/lib/financas";

export async function PUT(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = ValorDaCategoria.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    return Response.json({
      data: await valorDaCategoria(u.id, r.data.mes, r.data.category_id, r.data.valor),
    });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
