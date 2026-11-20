import { NovoItemDoPlanejamento, ParametroDoMes } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";
import { novoItem, planejamento } from "@/lib/financas";

export async function GET(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = ParametroDoMes.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!r.success) return invalido(r.error);
  return Response.json({ data: await planejamento(u.id, r.data.mes) });
}

export async function POST(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = NovoItemDoPlanejamento.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    return Response.json({ data: await novoItem(u.id, r.data) }, { status: 201 });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
