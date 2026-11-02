import { describe, expect, it } from "vitest";
import { rotas } from "./specs.js";

describe("especificação das rotas", () => {
  it("toda rota tem schema de resposta, resumo e tag", () => {
    // Regra 3 do CLAUDE.md: endpoint sem schema não entra no OpenAPI.
    for (const rota of rotas) {
      expect(rota.response).toBeDefined();
      expect(rota.summary).not.toBe("");
      expect(rota.tags.length).toBeGreaterThan(0);
      // Fora de /v1 so o /admin, e sempre com o token de administracao.
      expect(rota.path.startsWith("/v1") || rota.auth === "admin").toBe(true);
    }
  });

  it("toda rota /admin exige o token de administracao", () => {
    for (const rota of rotas.filter((r) => r.path.startsWith("/admin"))) {
      expect(rota.auth).toBe("admin");
    }
  });

  it("não repete método e caminho", () => {
    const chaves = rotas.map((r) => `${r.method} ${r.path}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("só health é anônima entre as rotas declaradas", () => {
    const anonimas = rotas.filter((r) => r.anonymous === true).map((r) => r.path);
    expect(anonimas).toEqual(["/v1/health"]);
  });
});
