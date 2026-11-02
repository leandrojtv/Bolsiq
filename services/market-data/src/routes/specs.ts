import { HealthResponse, type RouteSpec } from "@bolsiq/contracts";

/**
 * Especificação das rotas, em Zod.
 *
 * Regra 3 do CLAUDE.md: todo endpoint tem schema Zod, aparece no OpenAPI e tem
 * teste. Esta lista é a única fonte: o `app.ts` registra a partir dela e o
 * `openapi-generate.ts` gera o documento a partir dela, então os dois não
 * conseguem divergir.
 *
 * As duas rotas abaixo são as únicas anônimas da API (ver
 * docs/api/guia-do-cliente.md).
 */
export const rotas: RouteSpec[] = [
  {
    method: "get",
    path: "/v1/health",
    summary: "Estado do serviço",
    tags: ["ops"],
    anonymous: true,
    response: HealthResponse,
  },
];
