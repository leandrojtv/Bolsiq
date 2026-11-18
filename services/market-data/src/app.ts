import Fastify, { type FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { Messaging } from "@bolsiq/messaging";
import type { StreamRegistrado } from "./stream/rota.js";
import type { ServicoDeDados } from "./dados/servico.js";
import { registrarRotas, type AdminDeJobs } from "./routes/registrar.js";

declare module "fastify" {
  interface FastifyInstance {
    stream: StreamRegistrado;
  }
}
import { buildOpenApi, BolsiqError, type ErrorCode } from "@bolsiq/contracts";
import type { Env } from "./config.js";
import { rotas } from "./routes/specs.js";
import { registrarStream } from "./stream/rota.js";

export interface AppDeps {
  env: Env;
  /**
   * Sonda do banco. **Obrigatória de propósito.**
   *
   * Antes era opcional e a ausência era tratada como sucesso, o que fazia o
   * health reportar `database: "ok"` com o Postgres inalcançável — porque o
   * `server.ts` não passava sonda nenhuma. Um health que não detecta queda é
   * pior que nenhum: o orquestrador confia nele.
   */
  verificarBanco: () => Promise<boolean>;
  /**
   * `true` no processo `worker`: serve só o health, sem a API pública nem o
   * documento OpenAPI.
   */
  apenasHealth?: boolean;
  /**
   * Conexão com o NATS, quando já existe.
   *
   * Opcional: a rota `/v1/stream` é registrada de qualquer forma, e o repasse
   * é ligado depois por `app.stream.ligar(messaging)`. O serviço sobe o HTTP
   * antes de conectar ao barramento, para o health responder com o NATS fora.
   */
  messaging?: Messaging;
  /** Leitura dos dados de mercado. Sem ele, só health, OpenAPI e stream. */
  servico?: ServicoDeDados;
  /** Fila de jobs para /admin/jobs. */
  admin?: AdminDeJobs;
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
    // O padrao do Fastify (100 caracteres por parametro) cortava
    // /v1/quotes/{tickers} com mais de 16 tickers em 414, abaixo dos 20 que o
    // contrato promete: 20 tickers de ate 12 caracteres e as virgulas, com folga.
    maxParamLength: 400,
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

  app.get("/v1/health", async (_request, reply) => {
    const bancoOk = await deps.verificarBanco();

    const corpo = {
      status: bancoOk ? ("ok" as const) : ("degraded" as const),
      role: env.ROLE,
      version: env.SERVICE_VERSION,
      checks: { database: bancoOk ? ("ok" as const) : ("fail" as const) },
    };

    // 503 quando degradado, não 200. O HEALTHCHECK da imagem e o
    // `docker compose up --wait` olham o status HTTP, não o corpo: devolver 200
    // com "degraded" faria o orquestrador considerar saudável um processo que
    // não alcança o banco.
    return reply.status(bancoOk ? 200 : 503).send(corpo);
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

  // Swagger UI em /docs, sobre o mesmo documento. O servidor relativo vem
  // primeiro para o "Try it out" chamar esta instância, e não produção.
  await app.register(swagger, {
    mode: "static",
    specification: {
      document: {
        ...documento,
        servers: [
          { url: "/", description: "esta instância" },
          ...(documento.servers as { url: string; description: string }[]),
        ],
      } as never,
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  if (deps.servico) {
    registrarRotas(app, {
      servico: deps.servico,
      ...(deps.admin ? { admin: deps.admin } : {}),
      ...(env.ADMIN_TOKEN ? { adminToken: env.ADMIN_TOKEN } : {}),
    });
  }

  const stream = await registrarStream(app);
  app.decorate("stream", stream);
  app.addHook("onClose", async () => {
    await stream.parar();
  });

  if (deps.messaging) {
    stream.ligar(deps.messaging);
  }

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
