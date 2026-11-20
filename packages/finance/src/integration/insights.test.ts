import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { comoUsuario } from "../db/sessao.js";
import {
  apagarLancamento,
  criarConta,
  criarLancamento,
  listarCategorias,
  semearCategorias,
  type Tx,
} from "../db/operacoes.js";
import {
  assinaturaParaRecorrencia,
  baseDoSimulador,
  detalheDoInsight,
  EVENTO_INSIGHT_NOVO,
  listarAssinaturas,
  listarInsights,
  registrarFeedback,
  rotinaDeInsights,
  salvarConfiguracao,
} from "../db/insights.js";
import { listarRecorrencias } from "../db/recorrencias.js";
import { NovaConta, NovoLancamento } from "../contratos.js";
import { ConfiguracaoDeInsights } from "../insights/contratos.js";

const HOST = process.env.TEST_HOST ?? "127.0.0.1";
const A = "user-aaa";
const B = "user-bbb";
const HOJE = "2026-11-20";
const MES = "2026-11";

let container: StartedTestContainer;
let dono: Pool;
let app: Pool;
let db: NodePgDatabase<Record<string, unknown>>;
let conta = "";
let categoria: (nome: string) => string = () => "";

const comoA = <T>(f: (tx: Tx) => Promise<T>) => comoUsuario(db, A, f);
const lancar = (descricao: string, valor: string, data: string, cat?: string) =>
  comoA((tx) =>
    criarLancamento(
      tx,
      A,
      NovoLancamento.parse({
        tipo: "despesa",
        valor,
        data,
        descricao,
        account_id: conta,
        category_id: cat ? categoria(cat) : null,
      }),
    ),
  );
const eventos = async () =>
  (
    await dono.query<{
      payload: { user_id: string; motivo: string; insight_id: string };
    }>("select payload from finance.outbox where event_name = $1 order by created_at", [
      EVENTO_INSIGHT_NOVO,
    ])
  ).rows.map((r) => r.payload);

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
  const porta = container.getMappedPort(5432);
  dono = new Pool({
    connectionString: `postgres://dono:dono@${HOST}:${porta}/ci`,
    max: 3,
  });
  const pasta = resolve(import.meta.dirname, "../../migrations");
  for (const arquivo of readdirSync(pasta)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const bloco of readFileSync(resolve(pasta, arquivo), "utf8").split(
      "--> statement-breakpoint",
    ))
      if (bloco.trim() !== "") await dono.query(bloco);
  await dono.query("ALTER ROLE bolsiq_app LOGIN PASSWORD 'app'");
  app = new Pool({
    connectionString: `postgres://bolsiq_app:app@${HOST}:${porta}/ci`,
    max: 2,
  });
  db = drizzle(dono);

  for (const u of [A, B]) await comoUsuario(db, u, (tx) => semearCategorias(tx, u));
  const cats = await comoA((tx) => listarCategorias(tx, A));
  categoria = (nome) => cats.find((c) => c.nome === nome)?.id ?? "";
  conta = (
    await comoA((tx) =>
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

  for (const data of ["2026-08-05", "2026-09-05", "2026-10-05"])
    await lancar("Netflix", "39.90", data, "Assinaturas");
  await lancar("Netflix", "44.90", "2026-11-05", "Assinaturas");
  await lancar("Juros Rotativo", "180.00", "2026-10-15");
  for (const data of ["2026-10-01", "2026-10-15", "2026-11-01", "2026-11-10"])
    await lancar("Cafe Central", "12.50", data);
}, 180_000);

afterAll(async () => {
  await app?.end().catch(() => undefined);
  await dono?.end().catch(() => undefined);
  await container?.stop().catch(() => undefined);
});

describe("job de insights", () => {
  it("recalcula todos os usuarios com lancamento e publica as novidades uma vez", async () => {
    expect(await rotinaDeInsights(db, HOJE)).toEqual({ usuarios: 1, eventos: 2 });
    const publicados = await eventos();
    expect(publicados.map((p) => p.motivo).sort()).toEqual(["reajuste", "tarifa_nova"]);
    expect(publicados.every((p) => p.user_id === A)).toBe(true);

    // Rodar de novo nao duplica evento.
    expect(await rotinaDeInsights(db, HOJE, A)).toEqual({ usuarios: 1, eventos: 0 });
    expect(await eventos()).toHaveLength(2);
    const r = await dono.query(
      "select periodo from finance.insights where user_id = $1",
      [A],
    );
    expect(r.rows).toEqual([{ periodo: MES }]);
  });

  it("lista ordenada por impacto anual, com as evidencias", async () => {
    const l = await comoA((tx) => listarInsights(tx, A, MES, HOJE));
    expect(l.insights.map((i) => i.tipo)).toEqual([
      "assinatura",
      "formiga",
      "tarifas",
      "ranking",
    ]);
    const netflix = l.insights[0]!;
    expect(netflix).toMatchObject({ impacto_anual: "538.80", feedback: null });
    const det = await comoA((tx) => detalheDoInsight(tx, A, netflix.id, MES, HOJE));
    expect(det.evidencias.map((e) => [e.data, e.valor, e.origem])).toEqual([
      ["2026-11-05", "44.90", "Corrente"],
      ["2026-10-05", "39.90", "Corrente"],
      ["2026-09-05", "39.90", "Corrente"],
      ["2026-08-05", "39.90", "Corrente"],
    ]);
    expect(det.evidencias[0]?.categoria).toBe("Assinaturas");
    await expect(
      comoA((tx) => detalheDoInsight(tx, A, "assinatura-nada", MES, HOJE)),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("dispensado some e conta como oculto", async () => {
    const antes = await comoA((tx) => listarInsights(tx, A, MES, HOJE));
    const tarifas = antes.insights.find((i) => i.tipo === "tarifas")!;
    await comoA((tx) => registrarFeedback(tx, A, tarifas.id, "dispensado", MES, HOJE));
    const depois = await comoA((tx) => listarInsights(tx, A, MES, HOJE));
    expect(depois.insights.find((i) => i.tipo === "tarifas")).toBeUndefined();
    expect(depois.ocultos).toBe(1);
    // Depois de 90 dias volta.
    const volta = await comoA((tx) => listarInsights(tx, A, MES, "2027-02-18"));
    expect(volta.insights.find((i) => i.id === tarifas.id)?.feedback?.acao).toBe(
      "dispensado",
    );
  });

  it("lancamento novo ou apagado recalcula o cache", async () => {
    const [extra] = await lancar("Cafe Central", "12.50", "2026-11-18");
    const l = await comoA((tx) => listarInsights(tx, A, MES, HOJE));
    expect(l.insights.find((i) => i.tipo === "formiga")?.evidencias).toContain(extra!.id);
    await comoA((tx) => apagarLancamento(tx, A, extra!.id));
    const sem = await comoA((tx) => listarInsights(tx, A, MES, HOJE));
    expect(sem.insights.find((i) => i.tipo === "formiga")?.evidencias).not.toContain(
      extra!.id,
    );
  });

  it("configuracao muda o limite do efeito formiga", async () => {
    await comoA((tx) =>
      salvarConfiguracao(
        tx,
        A,
        ConfiguracaoDeInsights.parse({
          limite_formiga: "10",
          referencia: { essenciais: 50, nao_essenciais: 30, poupanca: 20 },
        }),
      ),
    );
    const l = await comoA((tx) => listarInsights(tx, A, MES, HOJE));
    expect(l.configuracao.limite_formiga).toBe("10.00");
    expect(l.insights.find((i) => i.tipo === "formiga")).toBeUndefined();
  });

  it("assinaturas, recorrente e simulador", async () => {
    const lista = await comoA((tx) => listarAssinaturas(tx, A, HOJE));
    expect(lista).toMatchObject({ total_mensal: "44.90", total_anual: "538.80" });
    const netflix = lista.assinaturas[0]!;
    expect(netflix.reajuste).toEqual({ de: "39.90", para: "44.90", percentual: 12.5 });

    await comoA((tx) => assinaturaParaRecorrencia(tx, A, netflix.id, HOJE));
    const { data: recs } = await comoA((tx) => listarRecorrencias(tx, A, HOJE));
    expect(recs[0]).toMatchObject({
      descricao: "Netflix",
      valor: "44.90",
      dia: 5,
      inicio: "2026-12-05",
      frequencia: "mensal",
    });
    const depois = await comoA((tx) => listarAssinaturas(tx, A, HOJE));
    expect(depois.assinaturas[0]?.feedback?.acao).toBe("ainda_uso");

    const base = await comoA((tx) =>
      baseDoSimulador(tx, A, HOJE, { diaria: "0.05", data: HOJE, fonte: "bcb-sgs" }),
    );
    expect(base.assinaturas.map((a) => a.nome)).toEqual(["Netflix"]);
    expect(base.categorias.find((c) => c.nome === "Assinaturas")?.media_mensal).toBe(
      "39.90",
    );
    expect(base.fluxo.meses).toHaveLength(12);
    expect(base.cdi?.fonte).toBe("bcb-sgs");
  });

  it("B nao ve insight, resposta nem ajuste de A", async () => {
    for (const t of ["insights", "insight_feedback", "insight_settings"]) {
      const c = await app.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('bolsiq.user_id', $1, true)", [B]);
        const r = await c.query(`select count(*)::int as n from finance.${t}`);
        expect(r.rows[0], t).toEqual({ n: 0 });
        await c.query("ROLLBACK");
      } finally {
        c.release();
      }
    }
  });
});
