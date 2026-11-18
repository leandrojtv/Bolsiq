import { z } from "zod";
import { apagarConversa, lerConversa } from "@/lib/assistente";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarAssistente } from "@/lib/respostas-assistente";

export const dynamic = "force-dynamic";

const Id = z.string().uuid("conversa inválida");
type Contexto = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Contexto) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const id = Id.safeParse((await ctx.params).id);
  if (!id.success) return invalido(id.error);
  try {
    return Response.json({ data: await lerConversa(u.id, id.data) });
  } catch (erro) {
    return tratarAssistente(erro);
  }
}

export async function DELETE(_req: Request, ctx: Contexto) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const id = Id.safeParse((await ctx.params).id);
  if (!id.success) return invalido(id.error);
  try {
    await apagarConversa(u.id, id.data);
    return new Response(null, { status: 204 });
  } catch (erro) {
    return tratarAssistente(erro);
  }
}
