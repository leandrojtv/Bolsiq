import { z } from "zod";
import { DecisaoDeDivergencia } from "@bolsiq/portfolio";
import { usuarioLogado } from "@/lib/auth";
import { importar, importarPosicao } from "@/lib/carteira";
import { ehLayoutDePosicao } from "@/lib/carteira-modelo";
import { naoAutenticado } from "@/lib/respostas";
import { tratarCarteira } from "@/lib/respostas-carteira";
import { erro, LIMITE_DE_ARQUIVO } from "./limites";

const Formato = z.enum(["bolsiq", "b3", "posicao_bolsiq"]);

function lerDecisoes(bruto: FormDataEntryValue | null | undefined) {
  if (typeof bruto !== "string") return [];
  try {
    return z.array(DecisaoDeDivergencia).parse(JSON.parse(bruto));
  } catch {
    return null;
  }
}

/**
 * multipart: `arquivo` (CSV), `formato` e, em posicao, `decisoes` (JSON com o que
 * fazer em cada divergencia). Arquivo com cabecalho de posicao e posicao, seja
 * qual for o formato escolhido.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const form = await req.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  const formato = Formato.safeParse(form?.get("formato"));
  const decisoes = lerDecisoes(form?.get("decisoes"));
  if (!(arquivo instanceof File)) return erro("Envie o arquivo CSV.");
  if (arquivo.size > LIMITE_DE_ARQUIVO) return erro("Arquivo acima de 5 MB.", 413);
  if (!formato.success) return erro("Formato deve ser bolsiq, b3 ou posicao_bolsiq.");
  if (!decisoes) return erro("Decisões das divergências inválidas.");
  try {
    const id = (await ctx.params).id;
    const conteudo = await arquivo.text();
    const relatorio =
      formato.data === "posicao_bolsiq" || ehLayoutDePosicao(conteudo)
        ? await importarPosicao(u.id, id, arquivo.name, conteudo, decisoes)
        : await importar(u.id, id, formato.data, arquivo.name, conteudo);
    return Response.json({ data: relatorio }, { status: 201 });
  } catch (e) {
    return tratarCarteira(e);
  }
}
