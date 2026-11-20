import { describe, expect, it } from "vitest";
import { openApiDeFinancas, ROTAS_DE_FINANCAS } from "./openapi.js";

describe("OpenAPI do BFF de financas", () => {
  const doc = openApiDeFinancas("0.0.0") as {
    paths: Record<string, Record<string, { security: unknown; parameters?: unknown[] }>>;
    components: { securitySchemes: Record<string, unknown> };
  };

  it("tem toda rota declarada, com a sessao como autenticacao", () => {
    for (const r of ROTAS_DE_FINANCAS) {
      const op = doc.paths[r.path]?.[r.method];
      expect(op, `${r.method} ${r.path}`).toBeDefined();
      expect(op?.security).toEqual([{ sessao: [] }]);
    }
    expect(Object.keys(doc.components.securitySchemes)).toEqual(["sessao"]);
  });

  it("upload de OFX e multipart", () => {
    const op = (doc.paths["/api/financas/importacoes"]?.post ?? {}) as {
      requestBody?: { content: Record<string, unknown> };
    };
    expect(Object.keys(op.requestBody?.content ?? {})).toEqual(["multipart/form-data"]);
    const linha = doc.paths["/api/financas/importacoes/{id}/linhas/{linha}"]?.patch;
    expect(linha?.parameters).toHaveLength(2);
  });

  it("parametros de caminho e de consulta entram", () => {
    const lista = doc.paths["/api/financas/lancamentos"]?.get;
    expect(lista?.parameters?.length).toBeGreaterThanOrEqual(8);
    expect(doc.paths["/api/financas/contas/{id}"]?.patch?.parameters).toHaveLength(1);
  });

  it("rotas de insights com o id no caminho", () => {
    expect(
      doc.paths["/api/financas/insights/{id}/feedback"]?.post?.parameters,
    ).toHaveLength(2);
    expect(doc.paths["/api/financas/insights/configuracao"]?.put).toBeDefined();
    expect(
      doc.paths["/api/financas/assinaturas/{id}/recorrente"]?.post?.parameters,
    ).toHaveLength(1);
  });
});
