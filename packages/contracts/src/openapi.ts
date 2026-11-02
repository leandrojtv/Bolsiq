import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodType, ZodTypeDef } from "zod";

/**
 * Schema de rota, sem `any`.
 *
 * `ZodTypeAny` é `ZodType<any, ...>`, e passar um valor tipado como `any`
 * adiante faz o ESLint reprovar (`no-unsafe-argument`) — com razão: `any`
 * atravessa a checagem de tipo em silêncio. `unknown` carrega a mesma
 * generalidade e mantém a verificação.
 */
export type AnySchema = ZodType<unknown, ZodTypeDef, unknown>;

export interface RouteSpec {
  method: "get" | "post" | "put" | "delete";
  path: string;
  summary: string;
  tags: string[];
  /** `true` quando a rota é pública (não exige X-API-Key). */
  anonymous?: boolean;
  /** `admin`: exige o token de administração em vez da chave de cliente. */
  auth?: "admin";
  response: AnySchema;
  query?: AnySchema;
  params?: AnySchema;
  body?: AnySchema;
}

export interface OpenApiOptions {
  title: string;
  version: string;
  description: string;
  servers: { url: string; description: string }[];
}

/**
 * Gera o documento OpenAPI a partir dos schemas Zod das rotas.
 *
 * Regra 3 do CLAUDE.md: todo endpoint tem schema Zod e aparece no OpenAPI.
 * Gerar daqui, e não escrever o YAML à mão, é o que garante que os dois nunca
 * divirjam — e é o que o check `contract` do CI compara com `oasdiff`.
 */
export function buildOpenApi(
  options: OpenApiOptions,
  routes: RouteSpec[],
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const parameters = [
      ...paramsToOpenApi(route.params, "path"),
      ...paramsToOpenApi(route.query, "query"),
    ];

    const operation: Record<string, unknown> = {
      summary: route.summary,
      tags: route.tags,
      responses: {
        "200": {
          description: "Sucesso",
          content: {
            "application/json": {
              schema: zodToJsonSchema(route.response, { target: "openApi3" }),
            },
          },
        },
      },
    };

    if (parameters.length > 0) {
      operation.parameters = parameters;
    }
    if (route.body) {
      operation.requestBody = {
        required: false,
        content: {
          "application/json": {
            schema: zodToJsonSchema(route.body, { target: "openApi3" }),
          },
        },
      };
    }
    if (route.auth === "admin") {
      operation.security = [{ adminToken: [] }];
    } else if (route.anonymous !== true) {
      operation.security = [{ apiKey: [] }];
    }

    const doPath = paths[route.path] ?? {};
    doPath[route.method] = operation;
    paths[route.path] = doPath;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: options.title,
      version: options.version,
      description: options.description,
    },
    servers: options.servers,
    components: {
      securitySchemes: {
        apiKey: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
        },
        adminToken: {
          type: "http",
          scheme: "bearer",
        },
      },
    },
    paths,
  };
}

function paramsToOpenApi(
  schema: AnySchema | undefined,
  location: "path" | "query",
): Record<string, unknown>[] {
  if (!schema) return [];

  const json = zodToJsonSchema(schema, { target: "openApi3" }) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  if (!json.properties) return [];

  return Object.entries(json.properties).map(([name, propSchema]) => ({
    name,
    in: location,
    required: location === "path" || (json.required?.includes(name) ?? false),
    schema: propSchema,
  }));
}
