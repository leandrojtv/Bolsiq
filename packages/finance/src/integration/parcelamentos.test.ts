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
  editarLancamento,
  listarCategorias,
  listarLancamentos,
  semearCategorias,
  type Tx,
} from "../db/operacoes.js";
import { criarCartao, listarFaturas } from "../db/cartoes.js";
import {
  confirmarImportacao,
  criarImportacao,
  desfazerImportacao,
  type ArquivoRecebido,
} from "../db/importacao.js";
import {
  amortizar,
  apagarDivida,
  apagarPlano,
  comprometidoPorMes,
  criarEmprestimo,
  criarParcelamentoNoCartao,
  detalheDoPlano,
  listarPlanos,
  quitar,
  simular,
} from "../db/parcelamentos.js";
import { criarRecorrencia } from "../db/recorrencias.js";
import { fluxoDeCaixa } from "../db/fluxo.js";
import { definirValorDaCategoria, sugerirPelaMedia } from "../db/planejamento.js";
import { criarMeta, listarMetas } from "../db/metas.js";
import { painelDoMes } from "../db/painel.js";
import { FiltroDeLancamentos, NovaConta, NovoLancamento } from "../contratos.js";
import { NovaImportacao, NovoCartao } from "../contratos-importacao.js";
import { NovaRecorrencia } from "../contratos-planejamento.js";
import {
  NovaMeta,
  NovoEmprestimo,
  NovoParcelamentoNoCartao,
} from "../contratos-parcelamento.js";
import { tabelaPrice } from "../emprestimo.js";

const HOST = process.env.TEST_HOST ?? "127.0.0.1";
const HOJE = "2024-11-20";
const A = "user-aaa";
const C = "user-ccc";

let container: StartedTestContainer;
let dono: Pool;
let db: NodePgDatabase<Record<string, unknown>>;
let conta = "";
let cartao = "";
let categoria: (nome: string) => string = () => "";

const como = <T>(u: string, f: (tx: Tx) => Promise<T>) => comoUsuario(db, u, f);
const comoA = <T>(f: (tx: Tx) => Promise<T>) => como(A, f);
const lancamentos = (f: Record<string, string>) =>
  comoA((tx) =>
    listarLancamentos(tx, A, FiltroDeLancamentos.parse({ ...f, por_pagina: 200 })),
  );

/** Fatura OFX de cartao com as linhas dadas (NAME, valor negativo, data). */
const ofxDeCartao = (
  nome: string,
  linhas: [string, string, string, string][],
): ArquivoRecebido => ({
  nome,
  bytes: new TextEncoder().encode(`OFXHEADER:100
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CCACCTFROM><ACCTID>9999</CCACCTFROM>
<BANKTRANLIST>${linhas
    .map(
      ([fitid, data, valor, name]) =>
        `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${data}<TRNAMT>${valor}<FITID>${fitid}<NAME>${name}</STMTTRN>`,
    )
    .join("")}</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`),
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
  db = drizzle(dono);
  for (const u of [A, C]) await como(u, (tx) => semearCategorias(tx, u));
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
          saldo_inicial: "20000",
          data_saldo_inicial: "2024-08-01",
        }),
        HOJE,
      ),
    )
  ).id;
  cartao = (
    await comoA((tx) =>
      criarCartao(
        tx,
        A,
        NovoCartao.parse({ nome: "Roxinho", dia_fechamento: 28, dia_vencimento: 5 }),
        HOJE,
      ),
    )
  ).id;
}, 180_000);

afterAll(async () => {
  await dono?.end().catch(() => undefined);
  await container?.stop().catch(() => undefined);
});

describe("compra parcelada no cartao", () => {
  it("3x de 100: plano e uma parcela em cada fatura", async () => {
    const p = await comoA((tx) =>
      criarParcelamentoNoCartao(
        tx,
        A,
        NovoParcelamentoNoCartao.parse({
          card_id: cartao,
          descricao: "Loja X",
          category_id: categoria("Compras"),
          data: "2024-11-20",
          n_parcelas: 3,
          valor_parcela: "100",
        }),
        HOJE,
      ),
    );
    expect(p).toMatchObject({
      valor_total: "300.00",
      parcelas_pagas: 1,
      parcelas_restantes: 2,
      proxima: { numero: 2, data: "2024-12-28", valor: "100.00" },
    });
    const faturas = await comoA((tx) => listarFaturas(tx, A, cartao, HOJE));
    for (const v of ["2024-12-05", "2025-01-05", "2025-02-05"])
      expect(faturas.find((f) => f.vencimento === v)?.total, v).toBe("100.00");
    const c = await comoA((tx) => comprometidoPorMes(tx, A, HOJE, 4));
    expect(c.map((m) => [m.mes, m.total])).toEqual([
      ["2024-11", "0.00"],
      ["2024-12", "100.00"],
      ["2025-01", "100.00"],
      ["2025-02", "100.00"],
    ]);
  });

  it("parcela importada concilia com a prevista; a mesma fatura de novo nao duplica", async () => {
    const pedido = NovaImportacao.parse({
      alvo: "cartao",
      card_id: cartao,
      vencimento: "2025-01-05",
    });
    const arquivo = ofxDeCartao("jan.ofx", [
      ["f-2", "20241221", "-100.00", "LOJA X PARC 02/03"],
    ]);
    const rev = await comoA((tx) => criarImportacao(tx, A, pedido, [arquivo]));
    expect(rev.linhas[0]).toMatchObject({
      situacao: "possivel_duplicata",
      acao: "conciliar",
    });
    await comoA((tx) => confirmarImportacao(tx, A, rev.id, undefined, HOJE));
    const parcela2 = (await lancamentos({ cartao })).data.find(
      (l) => l.descricao === "Loja X 2/3",
    );
    expect(parcela2?.status).toBe("realizado");
    const [plano] = await comoA((tx) => listarPlanos(tx, A));
    expect(plano).toMatchObject({ parcelas_pagas: 2, parcelas_restantes: 1 });
    expect((await lancamentos({ cartao })).meta.total).toBe(3);
    const outra = await comoA((tx) => criarImportacao(tx, A, pedido, [arquivo]));
    expect(outra.linhas[0]?.situacao).toBe("ja_importada");
  });

  it("parcela sem plano cria o plano e gera so as restantes; desfazer apaga", async () => {
    const pedido = NovaImportacao.parse({
      alvo: "cartao",
      card_id: cartao,
      vencimento: "2024-12-05",
    });
    const rev = await comoA((tx) =>
      criarImportacao(tx, A, pedido, [
        ofxDeCartao("dez.ofx", [
          ["tv-1", "20241110", "-250.00", "TV MAGAZINE PARC 01/04"],
        ]),
      ]),
    );
    expect(rev.linhas[0]).toMatchObject({
      situacao: "nova",
      parcela_atual: 1,
      parcela_total: 4,
    });
    await comoA((tx) => confirmarImportacao(tx, A, rev.id, undefined, HOJE));
    const tv = (await comoA((tx) => listarPlanos(tx, A))).find(
      (p) => p.descricao === "TV MAGAZINE",
    );
    expect(tv).toMatchObject({ n_parcelas: 4, parcelas_pagas: 1, parcelas_restantes: 3 });
    const det = await comoA((tx) => detalheDoPlano(tx, A, tv!.id));
    expect(det.tabela.map((l) => l.data)).toEqual([
      "2024-11-10",
      "2024-12-28",
      "2025-01-28",
      "2025-02-28",
    ]);
    // A fatura de janeiro do arquivo seguinte concilia com a parcela 2 gerada.
    const jan = await comoA((tx) =>
      criarImportacao(
        tx,
        A,
        NovaImportacao.parse({
          alvo: "cartao",
          card_id: cartao,
          vencimento: "2025-01-05",
        }),
        [
          ofxDeCartao("jan2.ofx", [
            ["tv-2", "20241210", "-250.00", "TV MAGAZINE PARC 02/04"],
          ]),
        ],
      ),
    );
    expect(jan.linhas[0]?.situacao).toBe("possivel_duplicata");
    await comoA((tx) => desfazerImportacao(tx, A, rev.id));
    expect((await comoA((tx) => listarPlanos(tx, A))).map((p) => p.descricao)).toEqual([
      "Loja X",
    ]);
  });
});

describe("emprestimo e financiamento", () => {
  let plano = "";

  it("Price gera as parcelas da tabela; amortizacao extra e quitacao refazem as previstas", async () => {
    const p = await comoA((tx) =>
      criarEmprestimo(
        tx,
        A,
        NovoEmprestimo.parse({
          origem: "emprestimo",
          account_id: conta,
          descricao: "Empréstimo pessoal",
          valor_financiado: "10.000,00",
          taxa_mensal: "1",
          n_parcelas: 12,
          sistema: "price",
          primeira_data: "2024-10-10",
        }),
        HOJE,
      ),
    );
    plano = p.id;
    // Out e nov ja passaram: realizadas.
    expect(p).toMatchObject({ parcelas_pagas: 2, parcelas_restantes: 10 });
    const ref = tabelaPrice("10000", "0.01", 12);
    expect(p.saldo_devedor).toBe(ref[1]!.saldo);
    const det = await comoA((tx) => detalheDoPlano(tx, A, plano));
    expect(det.tabela.map((l) => l.parcela)).toEqual(ref.map((l) => l.parcela));
    expect(det.tabela[0]).toMatchObject({
      juros: "100.00",
      amortizacao: ref[0]!.amortizacao,
    });

    const sim = await comoA((tx) => simular(tx, A, plano, "3000", "reduzir_prazo"));
    expect(sim.depois.parcelas).toBeLessThan(10);
    expect(Number(sim.juros_economizados)).toBeGreaterThan(0);
    const depois = await comoA((tx) =>
      amortizar(tx, A, plano, { extra: "3000", modo: "reduzir_prazo", data: HOJE }, HOJE),
    );
    expect(depois.parcelas_restantes).toBe(sim.depois.parcelas);
    expect(depois.tabela.at(-1)?.saldo).toBe("0.00");
    const q = await comoA((tx) => quitar(tx, A, plano, "2024-11-25", HOJE));
    expect(q).toMatchObject({
      parcelas_restantes: 0,
      ativo: false,
      saldo_devedor: "0.00",
    });
  });
});

describe("excluir divida", () => {
  it("apaga as previstas, mantem os realizados sem vinculo e respeita o dono", async () => {
    const p = await comoA((tx) =>
      criarEmprestimo(
        tx,
        A,
        NovoEmprestimo.parse({
          origem: "financiamento",
          account_id: conta,
          descricao: "Financiamento da moto",
          valor_financiado: "6.000,00",
          taxa_mensal: "1",
          n_parcelas: 6,
          sistema: "sac",
          primeira_data: "2024-09-10",
        }),
        HOJE,
      ),
    );
    // Set, out e nov pagas; amortizacao extra hoje vira mais um realizado.
    expect(p).toMatchObject({ parcelas_pagas: 3, parcelas_restantes: 3 });
    await comoA((tx) =>
      amortizar(tx, A, p.id, { extra: "500", modo: "reduzir_parcela", data: HOJE }, HOJE),
    );
    const linhas = async () =>
      (
        await dono.query<{
          status: string;
          installment_plan_id: string | null;
          parcela_numero: number | null;
        }>(
          `select status, installment_plan_id, parcela_numero from finance.transactions
            where user_id = $1 and descricao like '%Financiamento da moto%'
            order by data, descricao`,
          [A],
        )
      ).rows;
    expect((await linhas()).filter((l) => l.status === "previsto")).toHaveLength(3);
    const totalAntes = (await lancamentos({ conta })).meta.total;

    // Outro usuario nao enxerga o plano (RLS e filtro por dono): 404, nada muda.
    await expect(como(C, (tx) => apagarDivida(tx, A, p.id))).rejects.toMatchObject({
      status: 404,
    });
    await expect(como(C, (tx) => apagarDivida(tx, C, p.id))).rejects.toMatchObject({
      status: 404,
    });
    expect(await linhas()).toHaveLength(7);

    // Compra parcelada no cartao nao sai por aqui.
    const tv = await comoA((tx) =>
      criarParcelamentoNoCartao(
        tx,
        A,
        NovoParcelamentoNoCartao.parse({
          card_id: cartao,
          descricao: "Geladeira",
          data: HOJE,
          n_parcelas: 3,
          valor_parcela: "300",
        }),
        HOJE,
      ),
    );
    await expect(comoA((tx) => apagarDivida(tx, A, tv.id))).rejects.toMatchObject({
      status: 422,
    });

    const r = await comoA((tx) => apagarDivida(tx, A, p.id));
    expect(r).toEqual({ previstas_apagadas: 3, realizados_desvinculados: 4 });
    const depois = await linhas();
    expect(depois).toHaveLength(4);
    expect(
      depois.every(
        (l) =>
          l.status !== "previsto" &&
          l.installment_plan_id === null &&
          l.parcela_numero === null,
      ),
    ).toBe(true);
    expect((await lancamentos({ conta })).meta.total).toBe(totalAntes - 3);
    const planos = await comoA((tx) => listarPlanos(tx, A));
    expect(planos.map((x) => x.id)).not.toContain(p.id);
    expect(planos.map((x) => x.id)).toContain(tv.id);
    const auditoria = await dono.query<{ acao: string }>(
      "select acao from finance.audit_log where user_id = $1 and recurso_id = $2",
      [A, p.id],
    );
    expect(auditoria.rows.map((x) => x.acao)).toContain("divida.apagada");
    await expect(comoA((tx) => apagarDivida(tx, A, p.id))).rejects.toMatchObject({
      status: 404,
    });

    // A compra no cartao sai pela rota de parcelamentos, com a mesma regra.
    expect(await comoA((tx) => apagarPlano(tx, A, tv.id))).toEqual({
      previstas_apagadas: 2,
      realizados_desvinculados: 1,
    });
    await comoA((tx) =>
      listarLancamentos(tx, A, FiltroDeLancamentos.parse({ q: "Geladeira" })),
    ).then(async (r) => {
      for (const l of r.data) await comoA((tx) => apagarLancamento(tx, A, l.id));
    });
  });
});

describe("fluxo projetado, orcamento e metas", () => {
  it("fluxo com recorrencia, parcela e fatura: primeiro mes negativo", async () => {
    const cats = await como(C, (tx) => listarCategorias(tx, C));
    const cat = (n: string) => cats.find((c) => c.nome === n)?.id;
    const contaC = (
      await como(C, (tx) =>
        criarConta(
          tx,
          C,
          NovaConta.parse({
            nome: "C",
            tipo: "corrente",
            saldo_inicial: "1000",
            data_saldo_inicial: "2024-11-01",
          }),
          HOJE,
        ),
      )
    ).id;
    const cartaoC = (
      await como(C, (tx) =>
        criarCartao(
          tx,
          C,
          NovoCartao.parse({ nome: "K", dia_fechamento: 28, dia_vencimento: 5 }),
          HOJE,
        ),
      )
    ).id;
    await como(C, (tx) =>
      criarRecorrencia(
        tx,
        C,
        NovaRecorrencia.parse({
          tipo: "receita",
          descricao: "Bico",
          valor: "500",
          account_id: contaC,
          category_id: cat("Renda extra"),
          dia: 10,
          inicio: "2024-11-01",
        }),
        HOJE,
      ),
    );
    await como(C, (tx) =>
      criarRecorrencia(
        tx,
        C,
        NovaRecorrencia.parse({
          tipo: "despesa",
          descricao: "Aluguel",
          valor: "2000",
          account_id: contaC,
          dia: 15,
          inicio: "2025-01-01",
        }),
        HOJE,
      ),
    );
    await como(C, (tx) =>
      criarParcelamentoNoCartao(
        tx,
        C,
        NovoParcelamentoNoCartao.parse({
          card_id: cartaoC,
          descricao: "Geladeira",
          data: HOJE,
          n_parcelas: 3,
          valor_total: "900",
        }),
        HOJE,
      ),
    );
    const f = await como(C, (tx) => fluxoDeCaixa(tx, C, HOJE, 4));
    expect(f.saldo_inicial).toBe("1000.00");
    expect(f.meses).toEqual([
      { mes: "2024-11", entradas: "0.00", saidas: "0.00", saldo_final: "1000.00" },
      { mes: "2024-12", entradas: "500.00", saidas: "300.00", saldo_final: "1200.00" },
      { mes: "2025-01", entradas: "500.00", saidas: "2300.00", saldo_final: "-600.00" },
      { mes: "2025-02", entradas: "500.00", saidas: "2300.00", saldo_final: "-2400.00" },
    ]);
    expect(f.primeiro_mes_negativo).toBe("2025-01");
  });

  it("orcamento: valor inline, estados e sugestao pela media de 3 meses", async () => {
    for (const [data, valor] of [
      ["2024-08-10", "300"],
      ["2024-09-10", "450"],
      ["2024-10-10", "150"],
    ])
      await comoA((tx) =>
        criarLancamento(
          tx,
          A,
          NovoLancamento.parse({
            tipo: "despesa",
            valor,
            data,
            descricao: "Feira",
            account_id: conta,
            category_id: categoria("Mercado"),
          }),
        ),
      );
    expect(
      await comoA((tx) => sugerirPelaMedia(tx, A, "2024-11")),
    ).toBeGreaterThanOrEqual(1);
    const nov = await comoA((tx) =>
      definirValorDaCategoria(tx, A, "2024-11", categoria("Compras"), "120"),
    );
    // Compras em novembro: parcela 1/3 da Loja X (100) => 83%: atencao.
    expect(nov.categorias.find((c) => c.nome === "Compras")).toMatchObject({
      planejado: "120.00",
      consumo: "100.00",
      estado: "atencao",
    });
    const mercado = nov.categorias.find((c) => c.nome === "Mercado");
    expect(mercado?.planejado).toBe("300.00");
    const lanc = await comoA((tx) =>
      criarLancamento(
        tx,
        A,
        NovoLancamento.parse({
          tipo: "despesa",
          valor: "400",
          data: "2024-11-15",
          descricao: "Feira grande",
          account_id: conta,
          category_id: categoria("Mercado"),
        }),
      ),
    );
    const painel = await comoA((tx) => painelDoMes(tx, A, "2024-11-01", HOJE));
    expect(painel.orcamento).toMatchObject({
      planejado: "420.00",
      consumo: "500.00",
      estado: "estourado",
    });
    // Parcela 1/3 da Loja X e a parcela de novembro do emprestimo.
    expect(painel.comprometido_parcelas).toBe(
      (100 + Number(tabelaPrice("10000", "0.01", 12)[0]!.parcela)).toFixed(2),
    );
    await comoA((tx) => editarLancamento(tx, A, lanc[0]!.id, { status: "previsto" }));
  });

  it("metas: progresso pela conta ou pelo valor guardado e valor mensal necessario", async () => {
    await comoA((tx) =>
      criarMeta(
        tx,
        A,
        NovaMeta.parse({
          nome: "Viagem",
          valor_alvo: "12000",
          data_alvo: "2025-05-20",
          valor_guardado: "3000",
        }),
        HOJE,
      ),
    );
    await comoA((tx) =>
      criarMeta(
        tx,
        A,
        NovaMeta.parse({
          nome: "Reserva",
          valor_alvo: "1000",
          data_alvo: "2025-01-01",
          account_id: conta,
        }),
        HOJE,
      ),
    );
    const metas = await comoA((tx) =>
      listarMetas(tx, A, HOJE, () => Promise.resolve("0")),
    );
    expect(metas.find((m) => m.nome === "Viagem")).toMatchObject({
      fonte: "manual",
      valor_atual: "3000.00",
      progresso: 25,
      meses_restantes: 6,
      valor_mensal_necessario: "1500.00",
    });
    expect(metas.find((m) => m.nome === "Reserva")).toMatchObject({
      fonte: "conta",
      progresso: 100,
      valor_mensal_necessario: "0.00",
    });
  });
});
