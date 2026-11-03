import { usuarioLogado } from "@/lib/auth";
import { criarCarteira, listarCarteiras } from "@/lib/carteira";
import { NovaCarteira } from "@/lib/carteira-modelo";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarCarteira } from "@/lib/respostas-carteira";

export async function GET() {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  return Response.json({ data: await listarCarteiras(u.id) });
}

export async function POST(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = NovaCarteira.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    return Response.json(
      { data: await criarCarteira(u.id, r.data.nome) },
      { status: 201 },
    );
  } catch (erro) {
    return tratarCarteira(erro);
  }
}
