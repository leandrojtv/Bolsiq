import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { comoUsuario } from "../db/sessao.js";
import {
  criarConta,
  criarLancamento,
  editarLancamento,
  listarCategorias,
  listarLancamentos,
  semearCategorias,
  type Tx,
} from "../db/operacoes.js";
import {
  criarCartao,
  detalheDaFatura,
  fecharFaturas,
  listarCartoes,
  pagarFatura,
} from "../db/cartoes.js";
import {
  apagarRecorrencia,
  criarRecorrencia,
  editarRecorrencia,
  gerarPrevistos,
  listarRecorrencias,
} from "../db/recorrencias.js";
import { painelDoMes } from "../db/painel.js";
import {
  copiarPlanejamento,
  criarItem,
  definirValorDaCategoria,
  editarItem,
  obterPlanejamento,
  puxarRecorrencias,
} from "../db/planejamento.js";
import { rotinaDiaria } from "../db/rotina.js";
import { FiltroDeLancamentos, NovaConta, NovoLancamento } from "../contratos.js";
import { NovoCartao } from "../contratos-importacao.js";
import {
  EdicaoDeItemDoPlanejamento,
  EdicaoDeRecorrencia,
  NovaRecorrencia,
  NovoItemDoPlanejamento,
  PagamentoDeFatura,
} from "../contratos-planejamento.js";

const HOST = process.env.TEST_HOST ?? "127.0.0.1";
const A = "user-aaa";
const B = "user-bbb";

let container: StartedTestContainer;
let dono: Pool;
let app: Pool;
let db: NodePgDatabase<Record<string, unknown>>;
let conta = "";
let cartao = "";
let categoria: (nome: string) => string = () => "";

const comoA = <T>(f: (tx: Tx) => Promise<T>) => comoUsuario(db, A, f);
const lancamentos = (f: Record<string, string>) =>
  comoA((tx) =>
    listarLancamentos(tx, A, FiltroDeLancamentos.parse({ ...f, por_pagina: 200 })),
  );
const compra = (valor: string, data: string, cat = "Mercado") =>
  comoA((tx) =>
    criarLancamento(
      tx,
      A,
      NovoLancamento.parse({
        tipo: "despesa",
        valor,
        data,
        descricao: `Compra ${data}`,
        card_id: cartao,
        category_id: categoria(cat),
      }),
    ),
  );

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
          data_saldo_inicial: "2024-01-01",
        }),
        "2024-01-01",
      ),
    )
  ).id;
  cartao = (
    await comoA((tx) =>
      criarCartao(
        tx,
        A,
        NovoCartao.parse({
          nome: "Roxinho",
          dia_fechamento: 10,
          dia_vencimento: 17,
          limite: "3000",
          account_id: conta,
        }),
        "2024-03-01",
      ),
    )
  ).id;
}, 180_000);

afterAll(async () => {
  await app?.end().catch(() => undefined);
  await dono?.end().catch(() => undefined);
  await container?.stop().catch(() => undefined);
});

describe("fatura do cartao", () => {
  let marco = "";

  it("compra ate o dia do fechamento entra no ciclo; a fatura nasce na primeira compra", async () => {
    const [c1] = await compra("300", "2024-03-10");
    const [c2] = await compra("50", "2024-03-11");
    const [cartaoAgora] = await comoA((tx) => listarCartoes(tx, A, "2024-03-05"));
    expect(cartaoAgora?.fatura_atual).toMatchObject({
      vencimento: "2024-03-17",
      fechamento: "2024-03-10",
      status: "aberta",
      total: "300.00",
    });
    expect(cartaoAgora?.proxima_fatura).toMatchObject({
      vencimento: "2024-04-17",
      total: "50.00",
    });
    expect(cartaoAgora?.limite_usado).toBe("350.00");
    expect(c1?.statement_id).not.toBe(c2?.statement_id);
    marco = c1?.statement_id ?? "";
  });

  it("fechar gera o pagamento previsto na conta, uma vez so", async () => {
    expect(await comoA((tx) => fecharFaturas(tx, A, "2024-03-10"))).toBe(0);
    expect(await comoA((tx) => fecharFaturas(tx, A, "2024-03-11"))).toBe(1);
    expect(await comoA((tx) => fecharFaturas(tx, A, "2024-03-12"))).toBe(0);
    const previstos = await lancamentos({ conta, status: "previsto" });
    expect(previstos.data).toEqual([
      expect.objectContaining({
        tipo: "transferencia",
        transferencia_sentido: "saida",
        valor: "300.00",
        data: "2024-03-17",
      }),
    ]);
    // Compra lancada depois do fechamento, com data do ciclo: o previsto acompanha.
    await compra("20", "2024-03-09");
    await comoA((tx) => fecharFaturas(tx, A, "2024-03-12"));
    expect((await lancamentos({ conta, status: "previsto" })).data[0]?.valor).toBe(
      "320.00",
    );
  });

  it("pagar transforma o previsto em realizado e a despesa nao dobra no painel", async () => {
    const antes = await comoA((tx) => painelDoMes(tx, A, "2024-03-01", "2024-03-12"));
    expect(antes.despesas.total).toBe("370.00");
    expect(antes.a_pagar).toEqual([
      expect.objectContaining({ valor: "320.00", data: "2024-03-17", atrasado: false }),
    ]);
    const detalhe = await comoA((tx) =>
      pagarFatura(tx, A, cartao, marco, PagamentoDeFatura.parse({ data: "2024-03-15" })),
    );
    expect(detalhe.fatura).toMatchObject({
      status: "paga",
      total: "320.00",
      pagamentos: "320.00",
    });
    expect(detalhe.por_categoria).toEqual([
      { category_id: categoria("Mercado"), nome: "Mercado", valor: "320.00" },
    ]);
    const depois = await comoA((tx) => painelDoMes(tx, A, "2024-03-01", "2024-03-15"));
    // Compras de marco: 300 + 50 + 20. O pagamento de 320 nao entra.
    expect(depois.despesas.total).toBe("370.00");
    expect(depois.a_pagar).toEqual([]);
    expect((await lancamentos({ conta, status: "previsto" })).meta.total).toBe(0);
    const [c] = await comoA((tx) => listarCartoes(tx, A, "2024-03-15"));
    expect(c?.limite_usado).toBe("50.00");
    await expect(
      comoA((tx) =>
        pagarFatura(
          tx,
          A,
          cartao,
          marco,
          PagamentoDeFatura.parse({ data: "2024-03-16" }),
        ),
      ),
    ).rejects.toThrow(/já está paga/);
    // Saldo da conta caiu pelo pagamento (transferencia), uma vez.
    expect(depois.contas[0]?.saldo).toBe("4680.00");
    expect(
      (await comoA((tx) => detalheDaFatura(tx, A, cartao, marco))).lancamentos,
    ).toHaveLength(3);
  });
});

describe("recorrencias", () => {
  let aluguel = "";
  let luz = "";

  it("gera os previstos ate 90 dias, com dia 31 no ultimo dia do mes", async () => {
    const r = await comoA((tx) =>
      criarRecorrencia(
        tx,
        A,
        NovaRecorrencia.parse({
          tipo: "despesa",
          descricao: "Aluguel",
          valor: "1800",
          account_id: conta,
          category_id: categoria("Moradia"),
          dia: 31,
          inicio: "2024-01-01",
        }),
        "2024-01-15",
      ),
    );
    aluguel = r.id;
    expect(r).toMatchObject({ proxima: "2024-01-31", valor_mensal: "1800.00" });
    const datas = (
      await lancamentos({
        conta,
        status: "previsto",
        de: "2024-01-01",
        ate: "2024-04-30",
      })
    ).data
      .map((l) => l.data)
      .sort();
    // 15/01 + 90 dias = 14/04.
    expect(datas).toEqual(["2024-01-31", "2024-02-29", "2024-03-31"]);
  });

  it("rodar a rotina duas vezes nao duplica", async () => {
    const primeira = await rotinaDiaria(db, "2024-01-16");
    const segunda = await rotinaDiaria(db, "2024-01-16");
    expect(primeira.previstos).toBe(0);
    expect(segunda.previstos).toBe(0);
    expect(segunda.usuarios).toBeGreaterThanOrEqual(1);
    const outroDia = await rotinaDiaria(db, "2024-02-20");
    // 20/02 + 90 = 20/05: entram 30/04.
    expect(outroDia.previstos).toBe(1);
    expect((await rotinaDiaria(db, "2024-02-20")).previstos).toBe(0);
  });

  it("editar muda so os previstos futuros; o realizado fica", async () => {
    const jan = (await lancamentos({ conta, de: "2024-01-31", ate: "2024-01-31" }))
      .data[0];
    await comoA((tx) => editarLancamento(tx, A, jan!.id, { status: "realizado" }));
    await comoA((tx) =>
      editarRecorrencia(
        tx,
        A,
        aluguel,
        EdicaoDeRecorrencia.parse({ valor: "1900" }),
        "2024-02-01",
      ),
    );
    const todos = (await lancamentos({ conta, de: "2024-01-01", ate: "2024-06-30" })).data
      .filter((l) => l.descricao === "Aluguel")
      .map((l) => [l.data, l.valor, l.status])
      .sort();
    expect(todos).toEqual([
      ["2024-01-31", "1800.00", "realizado"],
      ["2024-02-29", "1900.00", "previsto"],
      ["2024-03-31", "1900.00", "previsto"],
      ["2024-04-30", "1900.00", "previsto"],
    ]);
  });

  it("valor variavel usa o ultimo realizado", async () => {
    luz = (
      await comoA((tx) =>
        criarRecorrencia(
          tx,
          A,
          NovaRecorrencia.parse({
            tipo: "despesa",
            descricao: "Luz",
            valor: "120",
            account_id: conta,
            category_id: categoria("Contas da casa"),
            dia: 5,
            inicio: "2024-02-01",
            valor_variavel: true,
          }),
          "2024-02-01",
        ),
      )
    ).id;
    const fev = (await lancamentos({ conta, de: "2024-02-05", ate: "2024-02-05" }))
      .data[0];
    await comoA((tx) =>
      editarLancamento(tx, A, fev!.id, { status: "realizado", valor: "157.30" }),
    );
    await comoA((tx) => gerarPrevistos(tx, A, "2024-02-06"));
    const luzes = (await lancamentos({ conta, de: "2024-03-01", ate: "2024-05-31" })).data
      .filter((l) => l.descricao === "Luz")
      .map((l) => l.valor);
    expect(luzes).toEqual(["157.30", "157.30", "157.30"]);
    const lista = await comoA((tx) => listarRecorrencias(tx, A, "2024-02-06"));
    expect(lista.totais).toEqual({
      receitas_mensais: "0.00",
      despesas_mensais: "2020.00",
    });
  });

  it("apagar remove os previstos futuros e mantem o realizado", async () => {
    await comoA((tx) => apagarRecorrencia(tx, A, luz, "2024-02-06"));
    const luzes = (
      await lancamentos({ conta, de: "2024-01-01", ate: "2024-12-31" })
    ).data.filter((l) => l.descricao === "Luz");
    expect(luzes.map((l) => l.status)).toEqual(["realizado"]);
  });
});

describe("planejamento", () => {
  it("compara com o realizado, sem criar lancamento, e copia sem duplicar", async () => {
    const antes = (await lancamentos({})).meta.total;
    const item = (x: Record<string, unknown>) =>
      comoA((tx) =>
        criarItem(tx, A, NovoItemDoPlanejamento.parse({ mes: "2024-03", ...x })),
      );
    await item({ category_id: categoria("Salário"), valor: "6000", fixo: true });
    await item({ category_id: categoria("Mercado"), valor: "400" });
    const p = await item({
      category_id: categoria("Mercado"),
      descricao: "Feira",
      valor: "100",
    });
    await expect(item({ category_id: categoria("Mercado"), valor: "1" })).rejects.toThrow(
      /Já existe/,
    );
    expect((await lancamentos({})).meta.total).toBe(antes);
    const mercado = p.categorias.find((c) => c.nome === "Mercado");
    expect(mercado).toMatchObject({
      planejado: "500.00",
      realizado: "370.00",
      restante: "130.00",
    });
    expect(p.totais).toMatchObject({
      receitas_planejadas: "6000.00",
      despesas_planejadas: "500.00",
      sobra_planejada: "5500.00",
    });
    expect(await comoA((tx) => copiarPlanejamento(tx, A, "2024-03", "2024-04"))).toBe(3);
    expect(await comoA((tx) => copiarPlanejamento(tx, A, "2024-03", "2024-04"))).toBe(0);
    expect(await comoA((tx) => puxarRecorrencias(tx, A, "2024-04"))).toBe(1);
    expect(await comoA((tx) => puxarRecorrencias(tx, A, "2024-04"))).toBe(0);
    const abril = await comoA((tx) => obterPlanejamento(tx, A, "2024-04"));
    expect(abril.itens.find((i) => i.descricao === "Aluguel")).toMatchObject({
      valor: "1900.00",
      fixo: true,
    });
    expect(abril.totais.despesas_fixas).toBe("1900.00");
  });

  it("item dividido guarda o fechado, orca a parte propria e copia a divisao", async () => {
    const moradia = categoria("Moradia");
    const p = await comoA((tx) =>
      criarItem(
        tx,
        A,
        NovoItemDoPlanejamento.parse({
          mes: "2024-05",
          category_id: moradia,
          descricao: "Condomínio",
          valor: "800",
          fixo: true,
          parte_propria: "50",
        }),
      ),
    );
    const cond = p.itens.find((i) => i.descricao === "Condomínio");
    expect(cond).toMatchObject({
      valor: "800.00",
      parte_propria: 50,
      valor_proprio: "400.00",
    });
    expect(p.totais).toMatchObject({
      despesas_fixas: "400.00",
      despesas_de_terceiros: "400.00",
    });
    // Inline da categoria: total = geral + parte propria dos itens descritos.
    const q = await comoA((tx) =>
      definirValorDaCategoria(tx, A, "2024-05", moradia, "500"),
    );
    expect(q.categorias.find((c) => c.category_id === moradia)?.planejado).toBe("500.00");
    expect(q.itens.find((i) => i.descricao === null)?.valor).toBe("100.00");
    await comoA((tx) => copiarPlanejamento(tx, A, "2024-05", "2024-06"));
    const junho = await comoA((tx) => obterPlanejamento(tx, A, "2024-06"));
    expect(junho.itens.find((i) => i.descricao === "Condomínio")?.parte_propria).toBe(50);
    const r = await comoA((tx) =>
      editarItem(
        tx,
        A,
        cond!.id,
        EdicaoDeItemDoPlanejamento.parse({ parte_propria: null }),
      ),
    );
    expect(r.totais.despesas_de_terceiros).toBe("0.00");
  });

  it("B nao ve recorrencia nem planejamento de A", async () => {
    for (const t of ["recurrences", "budget_items"]) {
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
