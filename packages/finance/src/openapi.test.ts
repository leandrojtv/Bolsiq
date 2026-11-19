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

  it("parametros de caminho e de consulta entram", () => {
    const lista = doc.paths["/api/financas/lancamentos"]?.get;
    expect(lista?.parameters?.length).toBeGreaterThanOrEqual(8);
    expect(doc.paths["/api/financas/contas/{id}"]?.patch?.parameters).toHaveLength(1);
  });
});
