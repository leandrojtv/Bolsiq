import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildOpenApi, type RouteSpec } from "./openapi.js";

const options = {
  title: "Bolsiq market-data",
  version: "0.0.0",
  description: "teste",
  servers: [{ url: "https://api.bolsiq.com/v1", description: "produção" }],
};

describe("buildOpenApi", () => {
  it("monta o documento com o security scheme de chave", () => {
    const doc = buildOpenApi(options, []) as Record<string, any>;
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.components.securitySchemes.apiKey).toEqual({
      type: "apiKey",
      in: "header",
      name: "X-API-Key",
    });
  });

  it("exige chave por padrão e dispensa em rota anônima", () => {
    const rotas: RouteSpec[] = [
      {
        method: "get",
        path: "/quotes/{ticker}",
        summary: "Cotação",
        tags: ["quotes"],
        response: z.object({ close: z.string() }),
        params: z.object({ ticker: z.string() }),
      },
      {
        method: "get",
        path: "/health",
        summary: "Health",
        tags: ["ops"],
        anonymous: true,
        response: z.object({ status: z.string() }),
      },
    ];

    const doc = buildOpenApi(options, rotas) as Record<string, any>;
    expect(doc.paths["/quotes/{ticker}"].get.security).toEqual([{ apiKey: [] }]);
    expect(doc.paths["/health"].get.security).toBeUndefined();
  });

  it("converte params de caminho como obrigatórios", () => {
    const doc = buildOpenApi(options, [
      {
        method: "get",
        path: "/quotes/{ticker}",
        summary: "Cotação",
        tags: ["quotes"],
        response: z.object({ close: z.string() }),
        params: z.object({ ticker: z.string() }),
      },
    ]) as Record<string, any>;

    const parametros = doc.paths["/quotes/{ticker}"].get.parameters;
    expect(parametros).toHaveLength(1);
    expect(parametros[0]).toMatchObject({ name: "ticker", in: "path", required: true });
  });

  it("respeita opcionalidade em query", () => {
    const doc = buildOpenApi(options, [
      {
        method: "get",
        path: "/quotes",
        summary: "Cotações",
        tags: ["quotes"],
        response: z.object({ items: z.array(z.string()) }),
        query: z.object({ tickers: z.string(), from: z.string().optional() }),
      },
    ]) as Record<string, any>;

    const parametros = doc.paths["/quotes"].get.parameters as Array<
      Record<string, unknown>
    >;
    const porNome = Object.fromEntries(parametros.map((p) => [p.name, p]));
    expect(porNome.tickers).toMatchObject({ in: "query", required: true });
    expect(porNome.from).toMatchObject({ in: "query", required: false });
  });

  it("agrupa métodos diferentes no mesmo path", () => {
    const doc = buildOpenApi(options, [
      {
        method: "get",
        path: "/jobs",
        summary: "Lista",
        tags: ["admin"],
        response: z.object({ jobs: z.array(z.string()) }),
      },
      {
        method: "post",
        path: "/jobs",
        summary: "Cria",
        tags: ["admin"],
        response: z.object({ id: z.string() }),
      },
    ]) as Record<string, any>;

    expect(Object.keys(doc.paths["/jobs"]).sort()).toEqual(["get", "post"]);
  });

  it("não cria parameters quando a rota não tem params nem query", () => {
    const doc = buildOpenApi(options, [
      {
        method: "get",
        path: "/health",
        summary: "Health",
        tags: ["ops"],
        anonymous: true,
        response: z.object({ status: z.string() }),
      },
    ]) as Record<string, any>;

    expect(doc.paths["/health"].get.parameters).toBeUndefined();
  });

  it("ignora schema de params que não é objeto", () => {
    // zodToJsonSchema de um schema sem properties não gera parameters.
    const doc = buildOpenApi(options, [
      {
        method: "get",
        path: "/quotes",
        summary: "Cotações",
        tags: ["quotes"],
        response: z.object({ ok: z.boolean() }),
        query: z.array(z.string()),
      },
    ]) as Record<string, any>;

    expect(doc.paths["/quotes"].get.parameters).toBeUndefined();
  });

  it("trata objeto de query sem campos obrigatórios", () => {
    const doc = buildOpenApi(options, [
      {
        method: "get",
        path: "/quotes",
        summary: "Cotações",
        tags: ["quotes"],
        response: z.object({ ok: z.boolean() }),
        query: z.object({ from: z.string().optional() }),
      },
    ]) as Record<string, any>;

    expect(doc.paths["/quotes"].get.parameters[0]).toMatchObject({
      name: "from",
      required: false,
    });
  });

  it("rota admin usa o token de administracao e documenta o corpo", () => {
    const doc = buildOpenApi(options, [
      {
        method: "post",
        path: "/admin/jobs/{name}",
        summary: "Dispara job",
        tags: ["admin"],
        auth: "admin",
        response: z.object({ id: z.string() }),
        params: z.object({ name: z.string() }),
        body: z.object({ data: z.record(z.string(), z.unknown()).optional() }),
      },
    ]) as Record<string, any>;

    const op = doc.paths["/admin/jobs/{name}"].post;
    expect(op.security).toEqual([{ adminToken: [] }]);
    expect(op.requestBody.content["application/json"].schema.type).toBe("object");
    expect(doc.components.securitySchemes.adminToken).toEqual({
      type: "http",
      scheme: "bearer",
    });
  });

  it("nao gera $ref relativo ao schema da resposta", () => {
    const Valor = z.string();
    const doc = buildOpenApi(options, [
      {
        method: "get",
        path: "/x",
        summary: "x",
        tags: ["x"],
        response: z.object({ a: Valor, b: Valor }),
      },
    ]);
    expect(JSON.stringify(doc)).not.toContain("$ref");
  });
});
