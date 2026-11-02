import { describe, expect, it } from "vitest";
import { ApiError, BolsiqError, ErrorCode, errorStatus } from "./errors.js";

describe("errorStatus", () => {
  it("cobre todos os códigos declarados", () => {
    for (const code of ErrorCode.options) {
      expect(errorStatus[code]).toBeGreaterThanOrEqual(400);
    }
    expect(Object.keys(errorStatus)).toHaveLength(ErrorCode.options.length);
  });

  it("devolve 401 para chave revogada, não 403", () => {
    // 403 informaria ao atacante que a chave existe.
    expect(errorStatus.invalid_api_key).toBe(401);
    expect(errorStatus.missing_api_key).toBe(401);
  });

  it("mapeia os códigos do guia do cliente", () => {
    expect(errorStatus.plan_upgrade_required).toBe(403);
    expect(errorStatus.rate_limit_exceeded).toBe(429);
    expect(errorStatus.too_many_tickers).toBe(400);
    expect(errorStatus.validation_error).toBe(422);
  });
});

describe("BolsiqError", () => {
  it("deriva o status do código", () => {
    const erro = new BolsiqError("rate_limit_exceeded", "limite excedido");
    expect(erro.status).toBe(429);
    expect(erro.code).toBe("rate_limit_exceeded");
    expect(erro.message).toBe("limite excedido");
    expect(erro.details).toBeUndefined();
    expect(erro).toBeInstanceOf(Error);
  });

  it("carrega details quando informado", () => {
    const erro = new BolsiqError("too_many_tickers", "demais", { max: 5 });
    expect(erro.details).toEqual({ max: 5 });
  });
});

describe("ApiError", () => {
  it("valida o envelope de erro", () => {
    const corpo = {
      error: {
        code: "not_found" as const,
        message: "Ticker inexistente.",
        correlation_id: "01JBQ7X8N4K2M9P3R5T7V9W1Y3",
      },
    };
    expect(ApiError.parse(corpo)).toEqual(corpo);
  });

  it("recusa código fora do contrato", () => {
    expect(() =>
      ApiError.parse({
        error: { code: "teapot", message: "x", correlation_id: "y" },
      }),
    ).toThrow();
  });
});
