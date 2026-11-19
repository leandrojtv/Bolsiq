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
  cartoes: vi.fn(),
  novoCartao: vi.fn(),
  mudarCartao: vi.fn(),
  removerCartao: vi.fn(),
  faturas: vi.fn(),
  analisar: vi.fn(),
  novaImportacao: vi.fn(),
  importacoes: vi.fn(),
  importacao: vi.fn(),
  mudarLinha: vi.fn(),
  confirmar: vi.fn(),
  cancelar: vi.fn(),
  desfazer: vi.fn(),
  regras: vi.fn(),
  novaRegra: vi.fn(),
  mudarRegra: vi.fn(),
  removerRegra: vi.fn(),
  limitesDeImportacao: () => ({ bytes: 1000, linhas: 100, arquivos: 2 }),
}));

vi.mock("@/lib/auth", () => ({ usuarioLogado: () => Promise.resolve(usuario.atual) }));
vi.mock("@/lib/financas", () => fin);
vi.mock("@/lib/alertas", () => ({ ErroDeAlerta: class extends Error {} }));

const contas = await import("../app/api/financas/contas/route");
const conta = await import("../app/api/financas/contas/[id]/route");
const categoria = await import("../app/api/financas/categorias/[id]/route");
const lancamentos = await import("../app/api/financas/lancamentos/route");
const resumo = await import("../app/api/financas/resumo/route");
const openapi = await import("../app/api/financas/openapi/route");
const cartoes = await import("../app/api/financas/cartoes/route");
const importacoes = await import("../app/api/financas/importacoes/route");
const analise = await import("../app/api/financas/importacoes/analise/route");
const linha = await import("../app/api/financas/importacoes/[id]/linhas/[linha]/route");
const confirmar = await import("../app/api/financas/importacoes/[id]/confirmar/route");
const regras = await import("../app/api/financas/regras/route");

/** Corpo multipart montado a mao: o FormData do jsdom nao serve ao Request do Node. */
const multipart = (campos: Record<string, string>, arquivos: [string, string][]) => {
  const b = "----bolsiq";
  const partes = [
    ...Object.entries(campos).map(
      ([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
    ),
    ...arquivos.map(
      ([nome, conteudo]) =>
        `--${b}\r\nContent-Disposition: form-data; name="arquivos"; filename="${nome}"\r\nContent-Type: application/octet-stream\r\n\r\n${conteudo}\r\n`,
    ),
  ];
  return new Request("http://x/api", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${b}` },
    body: `${partes.join("")}--${b}--\r\n`,
  });
};

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

describe("BFF de cartoes, importacao e regras", () => {
  it("cartao valida os dias do ciclo", async () => {
    expect(
      (await cartoes.POST(post({ nome: "X", dia_fechamento: 40, dia_vencimento: 5 })))
        .status,
    ).toBe(422);
    fin.novoCartao.mockResolvedValue({ id: "k" });
    expect(
      (await cartoes.POST(post({ nome: "X", dia_fechamento: 3, dia_vencimento: 10 })))
        .status,
    ).toBe(201);
  });

  it("importacao: destino, arquivos e limites antes do modulo", async () => {
    expect(
      (await importacoes.POST(multipart({ alvo: "conta" }, [["a.ofx", "x"]]))).status,
    ).toBe(422);
    const sem = await importacoes.POST(multipart({ alvo: "conta", account_id: "c" }, []));
    expect(sem.status).toBe(422);
    const muitos = await importacoes.POST(
      multipart({ alvo: "conta", account_id: "c" }, [
        ["a.ofx", "x"],
        ["b.ofx", "x"],
        ["c.ofx", "x"],
      ]),
    );
    expect(
      ((await muitos.json()) as { error: { message: string } }).error.message,
    ).toMatch(/no máximo 2/);
    const grande = await importacoes.POST(
      multipart({ alvo: "conta", account_id: "c" }, [["g.ofx", "x".repeat(2000)]]),
    );
    expect(grande.status).toBe(422);
    expect(fin.novaImportacao).not.toHaveBeenCalled();

    fin.novaImportacao.mockResolvedValue({ id: "i" });
    const ok = await importacoes.POST(
      multipart({ alvo: "cartao", card_id: "k", vencimento: "2023-12-10" }, [
        ["a.ofx", "OFX"],
      ]),
    );
    expect(ok.status).toBe(201);
    const [uid, pedido, arquivos] = fin.novaImportacao.mock.calls[0] as [
      string,
      unknown,
      { nome: string; bytes: Uint8Array }[],
    ];
    expect([uid, pedido]).toEqual([
      "u1",
      { alvo: "cartao", card_id: "k", vencimento: "2023-12-10" },
    ]);
    expect(arquivos.map((a) => [a.nome, new TextDecoder().decode(a.bytes)])).toEqual([
      ["a.ofx", "OFX"],
    ]);
  });

  it("analise le os arquivos e mapeia erro de leitura", async () => {
    fin.analisar.mockRejectedValue(new ErroDeFinancas(422, "Não consegui ler a.ofx"));
    const r = await analise.POST(multipart({}, [["a.ofx", "x"]]));
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: { message: string } }).error.message).toMatch(
      /ler/,
    );
  });

  it("linha da revisao e confirmacao", async () => {
    const params = { params: Promise.resolve({ id: "i", linha: "l" }) };
    const req = (corpo: unknown) =>
      new Request("http://x", { method: "PATCH", body: JSON.stringify(corpo) });
    expect(
      (
        await linha.PATCH(
          req({ transferencia_conta_id: "a", transferencia_cartao_id: "b" }),
          params,
        )
      ).status,
    ).toBe(422);
    fin.mudarLinha.mockResolvedValue({ id: "i" });
    expect(
      (await linha.PATCH(req({ category_id: "k", criar_regra: true }), params)).status,
    ).toBe(200);
    fin.confirmar.mockRejectedValue(new ErroDeFinancas(409, "não está mais em revisão"));
    expect((await confirmar.POST(new Request("http://x"), ctx("i"))).status).toBe(409);
  });

  it("regra com regex invalida e recusada", async () => {
    expect(
      (await regras.POST(post({ padrao: "(x", modo: "regex", category_id: "k" }))).status,
    ).toBe(422);
    expect(fin.novaRegra).not.toHaveBeenCalled();
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
