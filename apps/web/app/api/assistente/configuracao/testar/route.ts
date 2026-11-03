import { testar } from "@/lib/assistente";
import { TestarConexao } from "@/lib/assistente-modelo";
import { usuarioLogado } from "@/lib/auth";
import { naoAutenticado } from "@/lib/respostas";
import { tratarAssistente } from "@/lib/respostas-assistente";

export const dynamic = "force-dynamic";

/** Testa a chave colada ou a salva e devolve os modelos. Nada e gravado aqui. */
export async function POST(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = TestarConexao.safeParse(await req.json().catch(() => null));
  if (!r.success)
    return Response.json(
      { error: { code: "validation_error", message: "Dados inválidos." } },
      { status: 422 },
    );
  try {
    return Response.json({ data: await testar(u.id, r.data) });
  } catch (erro) {
    return tratarAssistente(erro);
  }
}
