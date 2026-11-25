import { usuarioLogado } from "@/lib/auth";
import { analisar } from "@/lib/financas";
import { naoAutenticado } from "@/lib/respostas";
import { tratarFinancas } from "@/lib/respostas-financas";
import { arquivosDoForm, erroDeEnvio, mapeamentosDoForm } from "../arquivos";

/**
 * multipart: `arquivos` (.ofx ou .csv) e `mapeamentos` (JSON). Le sem gravar e
 * sugere o destino; CSV desconhecido volta em `para_mapear`, com as colunas.
 */
export async function POST(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const form = await req.formData().catch(() => null);
  const arquivos = await arquivosDoForm(form);
  if (typeof arquivos === "string") return erroDeEnvio(arquivos);
  const mapeamentos = mapeamentosDoForm(form);
  if (typeof mapeamentos === "string") return erroDeEnvio(mapeamentos);
  try {
    return Response.json({ data: await analisar(u.id, arquivos, mapeamentos) });
  } catch (erro) {
    return tratarFinancas(erro);
  }
}
