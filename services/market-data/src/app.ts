import Fastify, { type FastifyInstance } from "fastify";
import { buildOpenApi, BolsiqError, type ErrorCode } from "@bolsiq/contracts";
import type { Env } from "./config.js";
import { rotas } from "./routes/specs.js";

export interface AppDeps {
  env: Env;
  /** Injetável para teste; devolve `ok` quando o banco responde. */
  verificarBanco?: () => Promise<boolean>;
  /**
   * `true` no processo `worker`: serve só o health, sem a API pública nem o
   * documento OpenAPI.
   */
  apenasHealth?: boolean;
}

/**
 * Monta a aplicação HTTP.
 *
 * Não abre porta: quem escuta é o `server.ts`. Isso é o que permite testar a
 * aplicação inteira com `app.inject()`, sem socket.
 */
export async function criarApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env } = deps;

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Log em JSON (pino), conforme a stack definida no CLAUDE.md.
      redact: ["req.headers['x-api-key']", "req.headers.authorization"],
    },
    // O correlation ID atravessa o gateway e aparece na resposta e no log:
    // é por ele que uma requisição é rastreada ponta a ponta.
    requestIdHeader: "x-correlation-id",
    requestIdLogLabel: "correlation_id",
    genReqId: () => crypto.randomUUID(),
    disableRequestLogging: env.NODE_ENV === "test",
  });

  app.addHook("onSend", (request, reply, payload, done) => {
    void reply.header("x-correlation-id", request.id);
    done(null, payload);
  });

  app.setErrorHandler((erro: unknown, request, reply) => {
    const correlationId = String(request.id);

    if (erro instanceof BolsiqError) {
      void reply.status(erro.status).send({
        error: {
          code: erro.code,
          message: erro.message,
          correlation_id: correlationId,
          ...(erro.details === undefined ? {} : { details: erro.details }),
        },
      });
      return;
    }

    const status = statusDoErro(erro);
    const code: ErrorCode = status === 404 ? "not_found" : "internal_error";

    if (status >= 500) {
      request.log.error({ err: erro }, "erro não tratado");
    }

    void reply.status(status).send({
      error: {
        code,
        // Erro 5xx não revela detalhe interno ao cliente; ele vai para o log.
        message:
          status >= 500
            ? "Erro interno."
            : erro instanceof Error
              ? erro.message
              : "Requisição inválida.",
        correlation_id: correlationId,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: {
        code: "not_found" as ErrorCode,
        message: "Rota inexistente.",
        correlation_id: String(request.id),
      },
    });
  });

  app.get("/v1/health", async () => {
    const bancoOk = deps.verificarBanco ? await deps.verificarBanco() : true;

    return {
      status: bancoOk ? ("ok" as const) : ("degraded" as const),
      role: env.ROLE,
      version: env.SERVICE_VERSION,
      checks: { database: bancoOk ? ("ok" as const) : ("fail" as const) },
    };
  });

  if (deps.apenasHealth === true) {
    return app;
  }

  const documento = buildOpenApi(
    {
      title: "Bolsiq market-data",
      version: env.SERVICE_VERSION,
      description:
        "API de dados de mercado da B3. A licença de cada dado vem no campo " +
        "`provenance.license` da resposta e define o que pode ser redistribuído.",
      servers: [{ url: "https://api.bolsiq.com", description: "produção" }],
    },
    rotas,
  );

  app.get("/v1/openapi.json", () => documento);

  return app;
}

/** Extrai o status de um erro do Fastify sem presumir o seu tipo. */
function statusDoErro(erro: unknown): number {
  if (typeof erro === "object" && erro !== null && "statusCode" in erro) {
    const { statusCode } = erro;
    if (typeof statusCode === "number") {
      return statusCode;
    }
  }
  return 500;
}
