import "server-only";
import { ErroDeCarteira } from "./carteira";

export function tratarCarteira(erro: unknown) {
  if (erro instanceof ErroDeCarteira) {
    const code = { 404: "not_found", 409: "conflict" }[erro.status] ?? "validation_error";
    return Response.json(
      { error: { code, message: erro.message } },
      { status: erro.status },
    );
  }
  throw erro;
}
