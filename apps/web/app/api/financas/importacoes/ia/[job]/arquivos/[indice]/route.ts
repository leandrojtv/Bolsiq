import { NovaImportacao, ParametroDaLeitura } from "@bolsiq/finance/puro";
import { usuarioLogado } from "@/lib/auth";
import { leituraDoArquivo, revisarLeitura } from "@/lib/financas-leitura";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarLeitura } from "@/lib/respostas-leitura";

type Ctx = { params: Promise<{ job: string; indice: string }> };

/** O que foi lido do arquivo e o destino sugerido, antes de criar a revisao. */
export async function GET(_req: Request, ctx: Ctx) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const p = ParametroDaLeitura.safeParse(await ctx.params);
  if (!p.success) return invalido(p.error);
  try {
    return Response.json({
      data: await leituraDoArquivo(u.id, p.data.job, p.data.indice),
    });
  } catch (e) {
    return tratarLeitura(e);
  }
}

/** JSON NovaImportacao: cria a revisao de sempre com as linhas lidas. */
export async function POST(req: Request, ctx: Ctx) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const p = ParametroDaLeitura.safeParse(await ctx.params);
  if (!p.success) return invalido(p.error);
  const r = NovaImportacao.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    return Response.json(
      { data: await revisarLeitura(u.id, p.data.job, p.data.indice, r.data) },
      { status: 201 },
    );
  } catch (e) {
    return tratarLeitura(e);
  }
}
