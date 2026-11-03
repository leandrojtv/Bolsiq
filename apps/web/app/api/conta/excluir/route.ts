import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { usuarios } from "@bolsiq/auth";
import { banco } from "@/lib/analytics";
import { auth, usuarioLogado } from "@/lib/auth";
import { excluirDados } from "@/lib/conta";
import { invalido, naoAutenticado } from "@/lib/respostas";

const Confirmacao = z.object({
  confirmacao: z.literal("EXCLUIR", {
    errorMap: () => ({ message: 'Digite "EXCLUIR" para confirmar.' }),
  }),
});

/**
 * Exclui a conta e todos os dados (LGPD). Primeiro encerra a sessao (o
 * cookie sai na resposta), depois apaga os dados e a conta: sessoes, contas
 * de login e 2FA caem pela FK com cascade no schema `app`.
 */
export async function POST(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = Confirmacao.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);

  const saida = await auth.api.signOut({ headers: await headers(), asResponse: true });
  await excluirDados(u.id);
  await banco().delete(usuarios).where(eq(usuarios.id, u.id));

  const res = new Response(null, { status: 204 });
  for (const c of saida.headers.getSetCookie()) res.headers.append("set-cookie", c);
  return res;
}
