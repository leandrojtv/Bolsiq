import { z } from "zod";
import { alterarRegra, removerRegra } from "@/lib/alertas";
import { invalido, tratar } from "@/lib/respostas";
import { usuarioAtual } from "@/lib/usuario";

const Alteracao = z.object({ ativo: z.boolean() });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = Alteracao.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    await alterarRegra(await usuarioAtual(), (await ctx.params).id, r.data.ativo);
    return new Response(null, { status: 204 });
  } catch (erro) {
    return tratar(erro);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await removerRegra(await usuarioAtual(), (await ctx.params).id);
    return new Response(null, { status: 204 });
  } catch (erro) {
    return tratar(erro);
  }
}
