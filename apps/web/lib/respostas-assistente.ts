import "server-only";
import { ErroDoAssistente } from "./assistente";

export function tratarAssistente(erro: unknown) {
  if (erro instanceof ErroDoAssistente) {
    return Response.json(
      { error: { code: erro.codigo, message: erro.message } },
      { status: erro.status },
    );
  }
  throw erro;
}
