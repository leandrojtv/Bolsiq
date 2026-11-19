import { NovoCartao } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";
import { cartoes, novoCartao } from "@/lib/financas";

export async function GET() {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  return Response.json({ data: await cartoes(u.id) });
}

export async function POST(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = NovoCartao.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    return Response.json({ data: await novoCartao(u.id, r.data) }, { status: 201 });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
