import { CopiaDoPlanejamento } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";
import { copiarMes } from "@/lib/financas";

export async function POST(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = CopiaDoPlanejamento.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    return Response.json({ data: { itens: await copiarMes(u.id, r.data.de, r.data.para) } });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
