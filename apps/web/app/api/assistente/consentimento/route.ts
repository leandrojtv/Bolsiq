import { estadoDoAssistente, registrarConsentimento } from "@/lib/assistente";
import { PedidoDeConsentimento } from "@/lib/assistente-modelo";
import { usuarioLogado } from "@/lib/auth";
import { invalido, naoAutenticado } from "@/lib/respostas";

/** Sem corpo: consentimento de investimentos. `{ escopo: "financas" }`: o do Bolsiq Finanças. */
export async function POST(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const texto = await req.text().catch(() => "");
  let json: unknown;
  try {
    json = texto ? JSON.parse(texto) : undefined;
  } catch {
    json = null;
  }
  const corpo = PedidoDeConsentimento.safeParse(json);
  if (!corpo.success) return invalido(corpo.error);
  await registrarConsentimento(u.id, corpo.data.escopo);
  return Response.json({ data: await estadoDoAssistente(u.id) });
}
