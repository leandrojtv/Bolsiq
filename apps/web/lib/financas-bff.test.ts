import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErroDeFinancas, ROTAS_DE_FINANCAS } from "@bolsiq/finance";

const usuario = vi.hoisted(() => ({ atual: null as { id: string } | null }));
const fin = vi.hoisted(() => ({
  contas: vi.fn(),
  novaConta: vi.fn(),
  mudarConta: vi.fn(),
  removerConta: vi.fn(),
  categorias: vi.fn(),
  novaCategoria: vi.fn(),
  mudarCategoria: vi.fn(),
  removerCategoria: vi.fn(),
  lancamentos: vi.fn(),
  novoLancamento: vi.fn(),
  mudarLancamento: vi.fn(),
  removerLancamento: vi.fn(),
  resumo: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ usuarioLogado: () => Promise.resolve(usuario.atual) }));
vi.mock("@/lib/financas", () => fin);
vi.mock("@/lib/alertas", () => ({ ErroDeAlerta: class extends Error {} }));

const contas = await import("../app/api/financas/contas/route");
const conta = await import("../app/api/financas/contas/[id]/route");
const categoria = await import("../app/api/financas/categorias/[id]/route");
const lancamentos = await import("../app/api/financas/lancamentos/route");
const resumo = await import("../app/api/financas/resumo/route");
const openapi = await import("../app/api/financas/openapi.json/route");

const post = (corpo: unknown) =>
  new Request("http://x/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  usuario.atual = { id: "u1" };
  vi.clearAllMocks();
});

describe("BFF /api/financas", () => {
  it("sem sessao responde 401 e nao toca o modulo", async () => {
    usuario.atual = null;
    expect((await contas.GET()).status).toBe(401);
    expect((await lancamentos.POST(post({}))).status).toBe(401);
    expect((await conta.DELETE(new Request("http://x"), ctx("c1"))).status).toBe(401);
    expect(fin.contas).not.toHaveBeenCalled();
  });

  it("valida o corpo com o schema Zod: 422", async () => {
    const r = await contas.POST(post({ nome: "", tipo: "corrente" }));
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe(
      "validation_error",
    );
    expect(fin.novaConta).not.toHaveBeenCalled();
  });

  it("cria conta com o valor ja normalizado: 201", async () => {
    fin.novaConta.mockResolvedValue({ id: "c1" });
    const r = await contas.POST(
      post({
        nome: "Nubank",
        tipo: "corrente",
        saldo_inicial: "1.234,56",
        data_saldo_inicial: "2026-03-01",
      }),
    );
    expect(r.status).toBe(201);
    expect(fin.novaConta).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ saldo_inicial: "1234.56" }),
    );
  });

  it("erro do modulo vira o status dele", async () => {
    fin.removerCategoria.mockRejectedValue(new ErroDeFinancas(409, "sistema"));
    const r = await categoria.DELETE(new Request("http://x"), ctx("k1"));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: { code: "conflict", message: "sistema" } });
  });

  it("lista lancamentos com os filtros da URL", async () => {
    fin.lancamentos.mockResolvedValue({
      data: [],
      meta: { pagina: 2, por_pagina: 10, total: 0 },
    });
    const r = await lancamentos.GET(
      new Request(
        "http://x/api/financas/lancamentos?pagina=2&por_pagina=10&q=pad&status=previsto",
      ),
    );
    expect(r.status).toBe(200);
    expect(fin.lancamentos).toHaveBeenCalledWith("u1", {
      pagina: 2,
      por_pagina: 10,
      q: "pad",
      status: "previsto",
    });
    const ruim = await lancamentos.GET(new Request("http://x/api?status=pago"));
    expect(ruim.status).toBe(422);
  });

  it("transferencia sem destino e recusada antes do banco", async () => {
    const r = await lancamentos.POST(
      post({
        tipo: "transferencia",
        valor: "10",
        data: "2026-03-01",
        descricao: "x",
        account_id: "a",
      }),
    );
    expect(r.status).toBe(422);
  });

  it("resumo valida o mes", async () => {
    fin.resumo.mockResolvedValue({});
    expect((await resumo.GET(new Request("http://x/api?mes=2026-03"))).status).toBe(200);
    expect(fin.resumo).toHaveBeenCalledWith("u1", "2026-03");
    expect((await resumo.GET(new Request("http://x/api?mes=03-2026"))).status).toBe(422);
  });

  it("serve o OpenAPI", async () => {
    const doc = (await openapi.GET().json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toContain("/api/financas/lancamentos/{id}");
  });
});

describe("toda rota de app/api/financas esta no OpenAPI", () => {
  const raiz = resolve(import.meta.dirname, "../app/api/financas");
  const arquivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? arquivos(p) : f === "route.ts" ? [p] : [];
    });

  it("cada metodo exportado tem RouteSpec", () => {
    const declaradas = new Set(ROTAS_DE_FINANCAS.map((r) => `${r.method} ${r.path}`));
    const encontradas = arquivos(raiz).flatMap((arquivo) => {
      const caminho = `/api/financas/${relative(raiz, arquivo)}`
        .replace(/\/route\.ts$/, "")
        .replace(/\[(\w+)\]/g, "{$1}");
      return [
        ...readFileSync(arquivo, "utf8").matchAll(/export (?:async )?function (\w+)/g),
      ].map((m) => `${(m[1] ?? "").toLowerCase()} ${caminho}`);
    });
    expect(encontradas.length).toBeGreaterThan(10);
    for (const e of encontradas) expect(declaradas, e).toContain(e);
    expect(encontradas.length).toBe(declaradas.size);
  });
});
