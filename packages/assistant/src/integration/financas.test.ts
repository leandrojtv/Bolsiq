import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { MockLanguageModelV4 } from "ai/test";
import {
  comoUsuario,
  criarConta,
  criarLancamento,
  listarCategorias,
  NovaConta,
  NovoLancamento,
  semearCategorias,
} from "@bolsiq/finance";
import { fontesFinanceirasDoBanco } from "../financas/postgres.js";
import {
  relatorioDoUsuario,
  usuariosDoRelatorio,
  type Aviso,
} from "../financas/relatorio.js";

const HOST = process.env.TEST_HOST ?? "127.0.0.1";
const A = "user-aaa";
const B = "user-bbb";
const HOJE = "2026-11-20";

let container: StartedTestContainer;
let dono: Pool;
let db: NodePgDatabase<Record<string, unknown>>;

async function migrar(pasta: string) {
  for (const arquivo of readdirSync(pasta)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const bloco of readFileSync(resolve(pasta, arquivo), "utf8").split(
      "--> statement-breakpoint",
    ))
      if (bloco.trim() !== "") await dono.query(bloco);
}

const credencial = {
  mestra: null,
  ollama_url: "http://ollama:11434",
  ollama_hosts: ["ollama"],
};

const modelo = (texto: string) =>
  new MockLanguageModelV4({
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: "text", text: texto }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 3000, noCache: 3000, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 300, text: 300, reasoning: 0 },
        },
        warnings: [],
      }),
  });

beforeAll(async () => {
  container = await new GenericContainer("timescale/timescaledb-ha:pg17")
    .withEnvironment({
      POSTGRES_USER: "dono",
      POSTGRES_PASSWORD: "dono",
      POSTGRES_DB: "ci",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forSuccessfulCommand("pg_isready -h 127.0.0.1 -p 5432"))
    .withStartupTimeout(120_000)
    .start();
  dono = new Pool({
    connectionString: `postgres://dono:dono@${HOST}:${container.getMappedPort(5432)}/ci`,
    max: 3,
  });
  await migrar(resolve(import.meta.dirname, "../../../finance/migrations"));
  await migrar(resolve(import.meta.dirname, "../../migrations"));
  db = drizzle(dono);

  for (const u of [A, B]) await comoUsuario(db, u, (tx) => semearCategorias(tx, u));
  const cats = await comoUsuario(db, A, (tx) => listarCategorias(tx, A));
  const categoria = (nome: string) => cats.find((c) => c.nome === nome)?.id ?? null;
  const conta = (
    await comoUsuario(db, A, (tx) =>
      criarConta(
        tx,
        A,
        NovaConta.parse({
          nome: "Corrente",
          tipo: "corrente",
          saldo_inicial: "5000",
          data_saldo_inicial: "2026-01-01",
        }),
        "2026-01-01",
      ),
    )
  ).id;
  const lancar = (
    descricao: string,
    valor: string,
    data: string,
    cat: string | null,
    tipo: "despesa" | "receita" = "despesa",
  ) =>
    comoUsuario(db, A, (tx) =>
      criarLancamento(
        tx,
        A,
        NovoLancamento.parse({
          tipo,
          valor,
          data,
          descricao,
          account_id: conta,
          category_id: cat ? categoria(cat) : null,
        }),
      ),
    );
  for (const m of ["08", "09", "10", "11"]) {
    await lancar("Salario", "6000.00", `2026-${m}-05`, "Salário", "receita");
    await lancar("PIX ENVIADO MARIA SOUZA", "250.00", `2026-${m}-10`, "Outros");
    await lancar("Aluguel", "2000.00", `2026-${m}-03`, "Moradia");
  }
  await lancar("iFood *Burger", "45.90", "2026-10-12", "Restaurantes e delivery");
  await lancar("iFood *Sushi", "60.00", "2026-10-20", "Restaurantes e delivery");
  await lancar("Aporte Tesouro", "500.00", "2026-10-06", "Investimentos (aporte)");

  for (const [u, ligado] of [
    [A, true],
    [B, false],
  ] as const)
    await dono.query(
      `insert into assistant.settings (user_id, provedor, modelo, consentimento_em,
         consentimento_financas_em, relatorio_mensal, preco_entrada, preco_saida)
       values ($1, 'ollama', 'qwen3:8b', now(), now(), $2, 0, 0)`,
      [u, ligado],
    );
}, 180_000);

afterAll(async () => {
  await dono?.end().catch(() => undefined);
  await container?.stop().catch(() => undefined);
});

describe("FontesFinanceiras sobre o banco", () => {
  const fontes = () => fontesFinanceirasDoBanco(db, A, HOJE);

  it("lancamentos do periodo com categoria, aporte e origem", async () => {
    const r = await fontes().lancamentos("2026-10-01", "2026-10-31");
    expect(r.dados).toHaveLength(6);
    const aporte = r.dados.find((l) => l.descricao === "Aporte Tesouro");
    expect(aporte).toMatchObject({ aporte: true, categoria: "Investimentos (aporte)" });
    const aluguel = r.dados.find((l) => l.descricao === "Aluguel");
    expect(aluguel).toMatchObject({
      essencial: true,
      tipo_custo: "fixo",
      origem: "Corrente",
    });
    expect(r.proveniencia[0]?.fonte).toContain("Bolsiq Finanças");
  });

  it("resumo, fluxo e parcelas pelos modulos do finance", async () => {
    const r = await fontes().resumoDoMes("2026-10");
    expect(r.dados).toMatchObject({
      competencia: "2026-10",
      renda: { recebida: "6000.00" },
      despesas: { total: "2855.90" },
    });
    const f = await fontes().fluxo(3);
    expect(f.dados.meses).toHaveLength(3);
    const p = await fontes().parcelas();
    expect(p.dados).toEqual({ planos: [], por_mes: expect.any(Array) });
  });

  it("insights e assinaturas sem o nome da pessoa do PIX", async () => {
    const i = await fontes().insights();
    const pix = i.dados.find((x) => x.tipo === "assinatura");
    expect(pix?.titulo).toBe("Assinatura: PIX ENVIADO [pessoa]");
    expect(JSON.stringify(i.dados)).not.toMatch(/MARIA|SOUZA/);
    expect(pix?.essencial).toBe(false);
    const a = await fontes().assinaturas();
    expect(a.dados.assinaturas.map((x) => x.nome)).toEqual(["PIX ENVIADO [pessoa]"]);
  });

  it("RLS: outro usuario nao ve nada", async () => {
    const b = fontesFinanceirasDoBanco(db, B, HOJE);
    expect((await b.lancamentos("2026-01-01", "2026-12-31")).dados).toEqual([]);
    expect((await b.insights()).dados).toEqual([]);
  });
});

describe("relatorio mensal", () => {
  it("so quem ligou, uma vez por mes, com o consumo gravado", async () => {
    expect(await usuariosDoRelatorio(db, "2026-10")).toEqual([A]);
    const avisos: Aviso[] = [];
    const opcoes = {
      mes: "2026-10",
      hoje: "2026-11-01",
      credencial,
      avisar: (a: Aviso) => {
        avisos.push(a);
        return Promise.resolve();
      },
      modelo: modelo("Em outubro de 2026 entraram R$ 6.000,00."),
    };
    expect(await relatorioDoUsuario(db, A, opcoes)).toEqual({
      entregue: true,
      origem: "modelo",
    });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      user_id: A,
      chave: "2026-10",
      titulo: "Relatório de outubro de 2026",
      corpo: "Em outubro de 2026 entraram R$ 6.000,00.",
    });
    const uso = await dono.query(
      "select origem, tokens_entrada from assistant.usage where user_id = $1",
      [A],
    );
    expect(uso.rows).toEqual([{ origem: "relatorio", tokens_entrada: 3000 }]);

    expect(await relatorioDoUsuario(db, A, opcoes)).toEqual({
      entregue: false,
      motivo: "ja_entregue",
    });
    expect(await usuariosDoRelatorio(db, "2026-10")).toEqual([]);
    expect(await relatorioDoUsuario(db, B, opcoes)).toEqual({
      entregue: false,
      motivo: "desligado",
    });
  });

  it("mes sem lancamento nao gasta token", async () => {
    const avisos: Aviso[] = [];
    const r = await relatorioDoUsuario(db, A, {
      mes: "2026-12",
      hoje: "2027-01-01",
      credencial,
      avisar: (a) => {
        avisos.push(a);
        return Promise.resolve();
      },
      modelo: modelo("nao deveria ser chamado"),
    });
    expect(r).toEqual({ entregue: false, motivo: "sem_movimento" });
    expect(avisos).toEqual([]);
  });
});
