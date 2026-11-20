import { ParametroDoMes } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";
import { painel } from "@/lib/financas";

export async function GET(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = ParametroDoMes.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!r.success) return invalido(r.error);
  try {
    return Response.json({ data: await painel(u.id, r.data.mes) });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
