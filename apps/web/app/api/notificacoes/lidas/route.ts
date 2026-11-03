import { z } from "zod";
import { marcarLidas, naoLidasDe } from "@/lib/alertas";
import { invalido } from "@/lib/respostas";
import { usuarioAtual } from "@/lib/usuario";

/** `{ ids: [...] }` marca essas; `{}` marca todas. */
const Corpo = z.object({ ids: z.array(z.string().uuid()).max(200).optional() });

export async function POST(req: Request) {
  const r = Corpo.safeParse((await req.json().catch(() => null)) ?? {});
  if (!r.success) return invalido(r.error);
  const uid = await usuarioAtual();
  await marcarLidas(uid, r.data.ids ?? null);
  return Response.json({ nao_lidas: await naoLidasDe(uid) });
}
