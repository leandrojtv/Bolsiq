/** 5 MB: um extrato da B3 de varios anos tem algumas centenas de KB. */
export const LIMITE_DE_ARQUIVO = 5 * 1024 * 1024;

export const erro = (message: string, status = 422) =>
  Response.json({ error: { code: "validation_error", message } }, { status });
