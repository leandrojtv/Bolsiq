import { NovaMeta } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";
import { metas, novaMeta } from "@/lib/financas";

export async function GET() {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  return Response.json({ data: await metas(u.id) });
}

export async function POST(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = NovaMeta.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    return Response.json({ data: await novaMeta(u.id, r.data) }, { status: 201 });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
