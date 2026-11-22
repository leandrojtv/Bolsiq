import { usuarioLogado } from "@/lib/auth";
import { analisar } from "@/lib/financas";
import { naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";
import { arquivosDoForm, erroDeEnvio } from "../arquivos";

/** multipart: `arquivos` (um ou mais .ofx ou .csv do C6). Le sem gravar e sugere o destino. */
export async function POST(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const arquivos = await arquivosDoForm(await req.formData().catch(() => null));
  if (typeof arquivos === "string") return erroDeEnvio(arquivos);
  try {
    return Response.json({ data: await analisar(u.id, arquivos) });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
