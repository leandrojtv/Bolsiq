import type { ZodError } from "zod";
import {
  estadoDoAssistente,
  removerConfiguracao,
  salvarConfiguracao,
} from "@/lib/assistente";
import { SalvarConfiguracao } from "@/lib/assistente-modelo";
import { usuarioLogado } from "@/lib/auth";
import { naoAutenticado } from "@/lib/respostas";
import { tratarAssistente } from "@/lib/respostas-assistente";

export const dynamic = "force-dynamic";

/** Nenhuma resposta daqui traz a chave: so os 4 ultimos caracteres. */
export async function GET() {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  return Response.json({ data: await estadoDoAssistente(u.id) });
}

export async function PUT(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const r = SalvarConfiguracao.safeParse(await req.json().catch(() => null));
  if (!r.success) return invalidoSemEco(r.error);
  try {
    await salvarConfiguracao(u.id, r.data);
    return Response.json({ data: await estadoDoAssistente(u.id) });
  } catch (erro) {
    return tratarAssistente(erro);
  }
}

export async function DELETE() {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  await removerConfiguracao(u.id);
  return Response.json({ data: await estadoDoAssistente(u.id) });
}

/** Issue do Zod pode citar o valor recebido: aqui ele pode ser a chave. */
function invalidoSemEco(erro: ZodError) {
  return Response.json(
    {
      error: {
        code: "validation_error",
        message: erro.issues[0]?.message ?? "Dados inválidos.",
      },
    },
    { status: 422 },
  );
}
