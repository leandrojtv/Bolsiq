import { usuarioLogado } from "@/lib/auth";
import {
  estadoDaImportacaoIA,
  registrarConsentimentoDaImportacao,
} from "@/lib/importacao-ia";
import { ConsentimentoDaImportacao } from "@/lib/importacao-ia-modelo";
import { invalido, naoAutenticado } from "@/lib/respostas";

/** Estado da importacao com IA: modelo, capacidades, consentimento e limite do dia. */
export async function GET() {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  return Response.json({ data: await estadoDaImportacaoIA(u.id) });
}

/** Consentimento da primeira importacao com IA, e se o arquivo original fica guardado. */
export async function POST(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const corpo = ConsentimentoDaImportacao.safeParse(await req.json().catch(() => ({})));
  if (!corpo.success) return invalido(corpo.error);
  await registrarConsentimentoDaImportacao(u.id, corpo.data.guardar_original);
  return Response.json({ data: await estadoDaImportacaoIA(u.id) });
}
