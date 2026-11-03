import { z } from "zod";
import { inscreverPush, removerPush } from "@/lib/alertas";
import { env } from "@/lib/env";
import { invalido } from "@/lib/respostas";
import { usuarioAtual } from "@/lib/usuario";

const Inscricao = z.object({
  endpoint: z.string().url().startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(10), auth: z.string().min(8) }),
});

/** Chave publica VAPID. 404 quando o push nao esta configurado. */
export function GET() {
  if (!env.VAPID_PUBLIC_KEY)
    return Response.json(
      { error: { code: "not_found", message: "Push não configurado." } },
      { status: 404 },
    );
  return Response.json({ data: { chave: env.VAPID_PUBLIC_KEY } });
}

export async function POST(req: Request) {
  const r = Inscricao.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  await inscreverPush(await usuarioAtual(), r.data);
  return new Response(null, { status: 201 });
}

export async function DELETE(req: Request) {
  const r = z
    .object({ endpoint: z.string().url() })
    .safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  await removerPush(await usuarioAtual(), r.data.endpoint);
  return new Response(null, { status: 204 });
}
