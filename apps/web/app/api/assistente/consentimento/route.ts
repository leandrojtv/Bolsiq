import { estadoDoAssistente, registrarConsentimento } from "@/lib/assistente";
import { usuarioLogado } from "@/lib/auth";
import { naoAutenticado } from "@/lib/respostas";

export async function POST() {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  await registrarConsentimento(u.id);
  return Response.json({ data: await estadoDoAssistente(u.id) });
}
