import { usuarioLogado } from "@/lib/auth";
import { importar } from "@/lib/carteira";
import { naoAutenticado } from "@/lib/respostas";
import { tratarCarteira } from "@/lib/respostas-carteira";

/** 5 MB: um extrato da B3 de varios anos tem algumas centenas de KB. */
const LIMITE = 5 * 1024 * 1024;

const erro = (message: string, status = 422) =>
  Response.json({ error: { code: "validation_error", message } }, { status });

/** multipart: `arquivo` (CSV) e `formato` (`bolsiq` ou `b3`). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const form = await req.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  const formato = form?.get("formato");
  if (!(arquivo instanceof File)) return erro("Envie o arquivo CSV.");
  if (arquivo.size > LIMITE) return erro("Arquivo acima de 5 MB.", 413);
  if (formato !== "bolsiq" && formato !== "b3")
    return erro("Formato deve ser bolsiq ou b3.");
  try {
    const relatorio = await importar(
      u.id,
      (await ctx.params).id,
      formato,
      arquivo.name,
      await arquivo.text(),
    );
    return Response.json({ data: relatorio }, { status: 201 });
  } catch (e) {
    return tratarCarteira(e);
  }
}
