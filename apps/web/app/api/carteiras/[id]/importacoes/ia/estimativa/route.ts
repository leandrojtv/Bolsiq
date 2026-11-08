import { usuarioLogado } from "@/lib/auth";
import { estimarImportacaoIA } from "@/lib/importacao-ia";
import { OpcoesDoEnvio } from "@/lib/importacao-ia-modelo";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { lerEntradas, tratarImportacaoIA } from "@/lib/respostas-importacao-ia";

/**
 * multipart: `arquivos`, `texto`, `modelo`. Extrai e anonimiza sem chamar a IA e
 * devolve tokens e custo estimados por arquivo. Nada vai ao provedor.
 */
export async function POST(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const form = await req.formData().catch(() => null);
  const opcoes = OpcoesDoEnvio.safeParse({ modelo: form?.get("modelo") ?? undefined });
  if (!opcoes.success) return invalido(opcoes.error);
  try {
    const entradas = await lerEntradas(form);
    return Response.json({
      data: await estimarImportacaoIA(u.id, entradas, opcoes.data.modelo),
    });
  } catch (e) {
    return tratarImportacaoIA(e);
  }
}
