import { FiltroDeLancamentos, NovoLancamento } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { lancamentos, novoLancamento } from "@/lib/financas";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";

export async function GET(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = FiltroDeLancamentos.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!r.success) return invalido(r.error);
  return Response.json(await lancamentos(u.id, r.data));
}

/** Receita, despesa ou transferencia (devolve os dois lados do par). */
export async function POST(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = NovoLancamento.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    return Response.json({ data: await novoLancamento(u.id, r.data) }, { status: 201 });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
