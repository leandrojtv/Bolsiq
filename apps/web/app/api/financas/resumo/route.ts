import { ParametroMes } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { resumo } from "@/lib/financas";
import { invalido, naoAutenticado } from "@/lib/respostas";

export async function GET(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = ParametroMes.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!r.success) return invalido(r.error);
  return Response.json({ data: await resumo(u.id, r.data.mes) });
}
