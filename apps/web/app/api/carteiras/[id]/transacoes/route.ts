import { z } from "zod";
import { usuarioLogado } from "@/lib/auth";
import { adicionarTransacao, excluirAtivo, listarTransacoes } from "@/lib/carteira";
import { NovaTransacao } from "@/lib/carteira-modelo";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarCarteira } from "@/lib/respostas-carteira";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const PorTicker = z.object({
  ticker: z
    .string()
    .trim()
    .transform((t) => t.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{4,12}$/, "ticker inválido")),
});

const ticker = (req: Request) =>
  PorTicker.safeParse({ ticker: new URL(req.url).searchParams.get("ticker") ?? "" });

export async function GET(req: Request, ctx: Ctx) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = ticker(req);
  if (!r.success) return invalido(r.error);
  try {
    return Response.json({
      data: await listarTransacoes(u.id, (await ctx.params).id, r.data.ticker),
    });
  } catch (erro) {
    return tratarCarteira(erro);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = NovaTransacao.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    return Response.json(
      { data: await adicionarTransacao(u.id, (await ctx.params).id, r.data) },
      { status: 201 },
    );
  } catch (erro) {
    return tratarCarteira(erro);
  }
}

/** Exclui o ativo: todas as transacoes do ticker nesta carteira. */
export async function DELETE(req: Request, ctx: Ctx) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = ticker(req);
  if (!r.success) return invalido(r.error);
  try {
    return Response.json({
      data: await excluirAtivo(u.id, (await ctx.params).id, r.data.ticker),
    });
  } catch (erro) {
    return tratarCarteira(erro);
  }
}
