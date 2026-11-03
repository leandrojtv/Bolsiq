import { cookies } from "next/headers";
import { z } from "zod";
import { usuarioLogado } from "@/lib/auth";
import { vincularAparelho } from "@/lib/conta";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { COOKIE_DO_USUARIO, idProvisorio } from "@/lib/usuario";

const Corpo = z.object({ watchlist: z.array(z.string()).max(200).default([]) });

/** Chamado pelo navegador logo depois do login (ADR 0022). */
export async function POST(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = Corpo.safeParse((await req.json().catch(() => null)) ?? {});
  if (!r.success) return invalido(r.error);
  const lista = await vincularAparelho(u.id, await idProvisorio(), r.data.watchlist);
  (await cookies()).delete(COOKIE_DO_USUARIO);
  return Response.json({ data: { watchlist: lista } });
}
