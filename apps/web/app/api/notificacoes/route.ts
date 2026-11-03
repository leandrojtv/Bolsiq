import { listarNotificacoes } from "@/lib/alertas";
import { usuarioAtual } from "@/lib/usuario";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const soNaoLidas = new URL(req.url).searchParams.get("filtro") === "nao_lidas";
  return Response.json(await listarNotificacoes(await usuarioAtual(), soNaoLidas));
}
