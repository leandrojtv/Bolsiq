import "server-only";
import type { ZodError } from "zod";
import { ErroDeAlerta } from "./alertas";

export function invalido(erro: ZodError) {
  return Response.json(
    {
      error: {
        code: "validation_error",
        message: erro.issues[0]?.message ?? "Dados inválidos.",
        details: erro.issues,
      },
    },
    { status: 422 },
  );
}

/** ErroDeAlerta vira o status dele; o resto sobe para o handler de erro do Next. */
export function tratar(erro: unknown) {
  if (erro instanceof ErroDeAlerta) {
    return Response.json(
      {
        error: {
          code: erro.status === 404 ? "not_found" : "validation_error",
          message: erro.message,
        },
      },
      { status: erro.status },
    );
  }
  throw erro;
}

export const naoAutenticado = () =>
  Response.json(
    { error: { code: "unauthorized", message: "Entre na sua conta." } },
    { status: 401 },
  );
