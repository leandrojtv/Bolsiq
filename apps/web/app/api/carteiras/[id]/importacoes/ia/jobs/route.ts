import { usuarioLogado } from "@/lib/auth";
import { criarJobDeImportacao, ultimoJob } from "@/lib/importacao-ia";
import { naoAutenticado } from "@/lib/respostas";
import { lerEnvio, tratarImportacaoIA } from "@/lib/respostas-importacao-ia";

/**
 * multipart: `arquivos`, `texto`, `corretoras`, `senhas`, `modelo`,
 * `aceitar_imagem`. Cria o job e devolve o id; quem processa e o worker. CSV ja
 * no layout do Bolsiq volta em `atalhos`, para o importador sem IA.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  try {
    const envio = await lerEnvio(await req.formData().catch(() => null));
    const r = await criarJobDeImportacao(u.id, (await ctx.params).id, envio.arquivos, {
      aceitar_imagem: envio.aceitar_imagem,
      ...(envio.modelo ? { modelo: envio.modelo } : {}),
    });
    return Response.json({ data: r }, { status: 202 });
  } catch (e) {
    return tratarImportacaoIA(e);
  }
}

/** O ultimo job da carteira nas ultimas 24 horas: a tela volta a ele. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  return Response.json({ data: await ultimoJob(u.id, (await ctx.params).id) });
}
