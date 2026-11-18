import { PerfilDoInvestidor } from "@bolsiq/assistant/puro";
import { lerPerfil, salvarPerfil } from "@/lib/assistente";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  return Response.json({ data: await lerPerfil(u.id) });
}

export async function PUT(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = PerfilDoInvestidor.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  await salvarPerfil(u.id, r.data);
  return Response.json({ data: r.data });
}
