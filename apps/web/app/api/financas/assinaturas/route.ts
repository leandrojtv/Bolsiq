import { usuarioLogado } from "@/lib/auth";
import { naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";
import { assinaturas } from "@/lib/financas";

export async function GET() {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    return Response.json({ data: await assinaturas(u.id) });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
