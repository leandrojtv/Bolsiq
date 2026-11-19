import "server-only";
import { ErroDeFinancas } from "@bolsiq/finance";

/** ErroDeFinancas vira o status dele; o resto sobe para o handler de erro do Next. */
export function tratarFinancas(erro: unknown) {
  if (erro instanceof ErroDeFinancas) {
    const code = { 404: "not_found", 409: "conflict" }[erro.status] ?? "validation_error";
    return Response.json(
      { error: { code, message: erro.message } },
      { status: erro.status },
    );
  }
  throw erro;
}
