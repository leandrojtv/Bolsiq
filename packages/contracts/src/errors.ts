import { z } from "zod";

/**
 * Códigos de erro da API pública.
 *
 * Contrato congelado em docs/api/guia-do-cliente.md. Acrescentar código é
 * compatível; renomear ou remover é quebra de contrato e exige `/v2`.
 */
export const ErrorCode = z.enum([
  "missing_api_key",
  "invalid_api_key",
  "plan_upgrade_required",
  "rate_limit_exceeded",
  "too_many_tickers",
  "validation_error",
  "not_found",
  "source_unavailable",
  "internal_error",
]);

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    correlation_id: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorCode = z.infer<typeof ErrorCode>;
export type ApiError = z.infer<typeof ApiError>;

/** Status HTTP de cada código, conforme o guia do cliente. */
export const errorStatus: Record<ErrorCode, number> = {
  missing_api_key: 401,
  // Chave revogada devolve 401, não 403: 403 revelaria que a chave existe.
  invalid_api_key: 401,
  plan_upgrade_required: 403,
  rate_limit_exceeded: 429,
  too_many_tickers: 400,
  validation_error: 422,
  not_found: 404,
  source_unavailable: 503,
  internal_error: 500,
};

export class BolsiqError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "BolsiqError";
    this.code = code;
    this.status = errorStatus[code];
    if (details !== undefined) {
      this.details = details;
    }
  }
}
