import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  BolsiqError,
  type AnySchema,
  type JobInfo,
  type RouteSpec,
} from "@bolsiq/contracts";
import type { ServicoDeDados } from "../dados/servico.js";
import { rotas } from "./specs.js";

export interface AdminDeJobs {
  listar(): Promise<JobInfo[]>;
  disparar(nome: string, dados: Record<string, unknown>): Promise<string>;
}

interface Entrada {
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  body: Record<string, unknown>;
}

type Manipulador = (e: Entrada) => Promise<unknown>;

function validar(
  schema: AnySchema | undefined,
  valor: unknown,
  onde: string,
): Record<string, unknown> {
  if (!schema) return {};
  const r = schema.safeParse(valor);
  if (!r.success) {
    throw new BolsiqError("validation_error", `${onde} inválido`, r.error.issues);
  }
  return (r.data ?? {}) as Record<string, unknown>;
}

function tokenConfere(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Chave de manipulador: o mesmo formato de `RouteSpec`, para casar um a um. */
export function chaveDaRota(spec: Pick<RouteSpec, "method" | "path">): string {
  return `${spec.method} ${spec.path}`;
}

export function manipuladores(
  servico: ServicoDeDados,
  admin: AdminDeJobs | undefined,
): Record<string, Manipulador> {
  const s = (v: unknown) => v as string;
  return {
    "get /v1/assets": ({ query }) =>
      servico.buscarAtivos(s(query.q), query.type as string | undefined),
    "get /v1/assets/{ticker}": ({ params }) => servico.ativo(s(params.ticker)),
    "get /v1/quotes/{tickers}": ({ params }) =>
      servico.cotacoes(
        s(params.tickers)
          .split(",")
          .map((t) => t.trim().toUpperCase())
          .filter((t) => t !== ""),
      ),
    "get /v1/history/{ticker}": ({ params, query }) =>
      servico.historico(
        s(params.ticker),
        query as Parameters<ServicoDeDados["historico"]>[1],
      ),
    "get /v1/dividends/{ticker}": ({ params, query }) =>
      servico.proventos(s(params.ticker), query),
    "get /v1/fundamentals/{ticker}": ({ params, query }) =>
      servico.fundamentos(s(params.ticker), query.period as "annual" | "quarterly"),
    "get /v1/funds": ({ query }) => servico.buscarFundos(s(query.q)),
    "get /v1/funds/{cnpj}": ({ params }) => servico.fundo(s(params.cnpj)),
    "get /v1/funds/{cnpj}/history": ({ params, query }) =>
      servico.historicoDeFundo(s(params.cnpj), query),
    "get /v1/fiis/{ticker}/monthly": ({ params, query }) =>
      servico.informesFii(s(params.ticker), query),
    "get /v1/macro/{serie}": ({ params, query }) =>
      servico.macro(params.serie as Parameters<ServicoDeDados["macro"]>[0], query),
    "get /admin/jobs": async () => {
      if (!admin)
        throw new BolsiqError("source_unavailable", "fila de jobs indisponível");
      return { data: await admin.listar() };
    },
    "post /admin/jobs/{name}": async ({ params, body }) => {
      if (!admin)
        throw new BolsiqError("source_unavailable", "fila de jobs indisponível");
      const nome = s(params.name);
      const id = await admin.disparar(nome, (body.data ?? {}) as Record<string, unknown>);
      return { data: { job_id: id, name: nome } };
    },
  };
}

/**
 * Registra as rotas de dados a partir das specs.
 *
 * A validação de entrada usa o mesmo schema que gera o OpenAPI: o documento e
 * o comportamento não divergem. Rota sem manipulador (health, que o app
 * registra à parte) é pulada.
 */
export function registrarRotas(
  app: FastifyInstance,
  deps: { servico: ServicoDeDados; admin?: AdminDeJobs; adminToken?: string },
): void {
  const mapa = manipuladores(deps.servico, deps.admin);

  for (const spec of rotas) {
    const manipular = mapa[chaveDaRota(spec)];
    if (!manipular) continue;

    app.route({
      method: spec.method.toUpperCase(),
      url: spec.path.replace(/\{(\w+)\}/g, ":$1"),
      handler: async (req: FastifyRequest) => {
        if (spec.auth === "admin") exigirAdmin(req, deps.adminToken);
        return manipular({
          params: validar(spec.params, req.params, "parâmetro de caminho"),
          query: validar(spec.query, req.query, "parâmetro de consulta"),
          body: validar(spec.body, req.body ?? undefined, "corpo"),
        });
      },
    });
  }
}

function exigirAdmin(req: FastifyRequest, esperado: string | undefined): void {
  const cabecalho = req.headers.authorization ?? "";
  if (!cabecalho.startsWith("Bearer ")) {
    throw new BolsiqError("missing_api_key", "token de administração ausente");
  }
  // Sem ADMIN_TOKEN configurado, nenhum token vale: rota admin fechada por
  // padrão, nunca aberta por esquecimento.
  if (!esperado || !tokenConfere(cabecalho.slice(7), esperado)) {
    throw new BolsiqError("invalid_api_key", "token de administração inválido");
  }
}
