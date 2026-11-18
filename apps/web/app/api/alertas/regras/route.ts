import { criarRegra, listarRegras } from "@/lib/alertas";
import { NovaRegra } from "@/lib/alertas-modelo";
import { invalido, tratar } from "@/lib/respostas";
import { usuarioAtual } from "@/lib/usuario";

export async function GET() {
  return Response.json({ data: await listarRegras(await usuarioAtual()) });
}

export async function POST(req: Request) {
  const r = NovaRegra.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalido(r.error);
  try {
    return Response.json(
      { data: await criarRegra(await usuarioAtual(), r.data) },
      { status: 201 },
    );
  } catch (erro) {
    return tratar(erro);
  }
}
