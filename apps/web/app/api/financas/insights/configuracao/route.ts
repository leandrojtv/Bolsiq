import { ConfiguracaoDeInsights } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";
import { configuracaoDeInsights, configurarInsights } from "@/lib/financas";

export async function GET() {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    return Response.json({ data: await configuracaoDeInsights(u.id) });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}

export async function PUT(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = ConfiguracaoDeInsights.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    return Response.json({ data: await configurarInsights(u.id, r.data) });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
