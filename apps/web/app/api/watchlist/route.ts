import { z } from "zod";
import { usuarioLogado } from "@/lib/auth";
import { lerWatchlist, salvarWatchlist } from "@/lib/conta";
import { invalido, naoAutenticado } from "@/lib/respostas";

export async function GET() {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  return Response.json({ data: await lerWatchlist(u.id) });
}

export async function PUT(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = z
    .object({ tickers: z.array(z.string()).max(200) })
    .safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  return Response.json({ data: await salvarWatchlist(u.id, r.data.tickers) });
}
