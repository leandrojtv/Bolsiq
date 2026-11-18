import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import {
  assets,
  criarDb,
  criarPool,
  outbox,
  quotesDaily,
  type Db,
} from "@bolsiq/db-core";

import {
  carregarCadastroDeFundos,
  carregarInformeDiario,
  ultimosMeses,
  carregarCadastro,
  carregarCotahist,
  carregarDemonstracoes,
  carregarInformeFii,
  diasSemCotahist,
  marcarSemPregao,
} from "../dados/ingestao.js";
import { criarServicoDeDados } from "../dados/servico.js";
import { B3CotahistAdapter } from "../fontes/b3-cotahist.js";
import { BcbAdapter } from "../fontes/bcb.js";
import { BrapiAdapter } from "../fontes/brapi.js";
import { CvmAdapter } from "../fontes/cvm.js";
import {
  binario,
  buscarFalso,
  criarZip,
  json,
  linhaCotahist,
} from "../testes/fixtures.js";

const HOST = process.env.TEST_HOST ?? "127.0.0.1";
const log = () => undefined;

let container: StartedTestContainer;
let pool: ReturnType<typeof criarPool>;
let db: Db;

async function eventos(nome: string) {
  return db.select().from(outbox).where(eq(outbox.eventName, nome));
}

beforeAll(async () => {
  container = await new GenericContainer("timescale/timescaledb-ha:pg17")
    .withEnvironment({
      POSTGRES_USER: "bolsiq",
      POSTGRES_PASSWORD: "bolsiq",
      POSTGRES_DB: "bolsiq",
    })
    .withExposedPorts(5432)
    // A imagem sobe um Postgres temporario para o init e reinicia: a porta
    // abre antes de o banco aceitar conexao ("the database system is
    // starting up"). O temporario so escuta no socket, entao o pg_isready
    // por TCP so passa no servidor definitivo.
    .withWaitStrategy(Wait.forSuccessfulCommand("pg_isready -h 127.0.0.1 -p 5432"))
    .withStartupTimeout(120_000)
    .start();
  const url = `postgres://bolsiq:bolsiq@${HOST}:${container.getMappedPort(5432)}/bolsiq`;
  pool = criarPool({ url, maxConnections: 4 });
  await migrate(drizzle(pool), {
    migrationsFolder: resolve(
      import.meta.dirname,
      "../../../../packages/db-core/migrations",
    ),
    migrationsSchema: "drizzle",
  });
  db = criarDb(pool);
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

// ---------------------------------------------------------------------------

const ANO = [
  linhaCotahist({
    data: "2026-10-29",
    ticker: "PETR4",
    nome: "PETROBRAS",
    fechamento: 50,
  }),
  linhaCotahist({
    data: "2026-10-30",
    ticker: "PETR4",
    nome: "PETROBRAS",
    fechamento: 52,
  }),
  linhaCotahist({
    data: "2026-10-29",
    ticker: "BOVA11",
    codbdi: "14",
    especi: "CI",
    fechamento: 166.51,
    isin: "BRBOVACTF003",
  }),
  linhaCotahist({
    data: "2026-10-30",
    ticker: "BOVA11",
    codbdi: "14",
    especi: "CI",
    fechamento: 165.4,
    isin: "BRBOVACTF003",
  }),
].join("\n");

const DIA = linhaCotahist({
  data: "2026-11-02",
  ticker: "PETR4",
  nome: "PETROBRAS",
  fechamento: 53,
});

describe("COTAHIST", () => {
  it("carga anual grava precos, cria o universo e emite asset.listed", async () => {
    const zip = await criarZip({ "COTAHIST_A2026.TXT": ANO });
    const adapter = new B3CotahistAdapter(
      buscarFalso({ COTAHIST_A2026: () => binario(zip) }),
      "https://b3",
    );
    const arquivo = await adapter.ano(2026);
    const r = await carregarCotahist(db, arquivo!, { diario: false, log });

    expect(r).toMatchObject({ pulado: false, linhas: 4, ultimaData: "2026-10-30" });
    const listados = await eventos("marketdata.asset.listed.v1");
    expect(listados.map((e) => (e.payload as { ticker: string }).ticker).sort()).toEqual([
      "BOVA11",
      "PETR4",
    ]);
    expect(await eventos("marketdata.quote.updated.v1")).toHaveLength(0);

    const [petr] = await db.select().from(assets).where(eq(assets.ticker, "PETR4"));
    expect(petr).toMatchObject({
      kind: "stock",
      name: "PETROBRAS",
      source: "b3-cotahist",
    });
  });

  it("o mesmo arquivo nao e reprocessado", async () => {
    const zip = await criarZip({ "COTAHIST_A2026.TXT": ANO });
    const adapter = new B3CotahistAdapter(
      buscarFalso({ COTAHIST_A2026: () => binario(zip) }),
      "https://b3",
    );
    expect(
      (await carregarCotahist(db, (await adapter.ano(2026))!, { diario: false, log }))
        .pulado,
    ).toBe(true);
  });

  it("carga diaria emite quote.updated com a variacao e daily.closed", async () => {
    const zip = await criarZip({ "COTAHIST_D02112026.TXT": DIA });
    const adapter = new B3CotahistAdapter(
      buscarFalso({ COTAHIST_D02112026: () => binario(zip) }),
      "https://b3",
    );
    await carregarCotahist(db, (await adapter.dia("2026-11-02"))!, { diario: true, log });

    const [cotacao] = await eventos("marketdata.quote.updated.v1");
    expect(cotacao?.payload).toMatchObject({ ticker: "PETR4", price: "53", change: "1" });
    const [fechado] = await eventos("marketdata.daily.closed.v1");
    expect(fechado?.payload).toEqual({ date: "2026-11-02", assets_updated: 1 });
    // Papel ja conhecido nao e listado de novo.
    expect(await eventos("marketdata.asset.listed.v1")).toHaveLength(2);
  });

  it("lacuna lista dia util sem preco e desiste depois de 404 repetido", async () => {
    // Carregados pelos testes acima: 10-29, 10-30 e 11-02. O dia corrente
    // (11-06) fica fora: o arquivo dele so sai a noite.
    expect(await diasSemCotahist(db, "2026-11-06", 10)).toEqual([
      "2026-10-27",
      "2026-10-28",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ]);

    // Um 404 isolado pode ser arquivo atrasado: o dia continua na lista.
    expect(await marcarSemPregao(db, "2026-11-04")).toBe(1);
    expect(await diasSemCotahist(db, "2026-11-06", 10)).toContain("2026-11-04");

    // Repetido, e feriado: para de ser pedido.
    expect(await marcarSemPregao(db, "2026-11-04")).toBe(2);
    expect(await marcarSemPregao(db, "2026-11-04")).toBe(3);
    expect(await diasSemCotahist(db, "2026-11-06", 10)).not.toContain("2026-11-04");
  });
});

// ---------------------------------------------------------------------------

const CAB =
  "CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;GRUPO_DFP;MOEDA;ESCALA_MOEDA;ORDEM_EXERC;DT_INI_EXERC;DT_FIM_EXERC;CD_CONTA;DS_CONTA;VL_CONTA;ST_CONTA_FIXA";
const CAB_BP =
  "CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;GRUPO_DFP;MOEDA;ESCALA_MOEDA;ORDEM_EXERC;DT_FIM_EXERC;CD_CONTA;DS_CONTA;VL_CONTA;ST_CONTA_FIXA";
const P = "33.000.167/0001-01;2024-12-31;1;PETROBRAS;009512";

function dfp2024() {
  const fluxo = (conta: string, rotulo: string, valor: string) =>
    `${P};DFC;REAL;MIL;ÚLTIMO;2024-01-01;2024-12-31;${conta};${rotulo};${valor};N`;
  const res = (conta: string, valor: string) =>
    `${P};DRE;REAL;MIL;ÚLTIMO;2024-01-01;2024-12-31;${conta};x;${valor};S`;
  const bp = (conta: string, valor: string) =>
    `${P};BP;REAL;MIL;ÚLTIMO;2024-12-31;${conta};x;${valor};S`;
  return criarZip({
    "dfp_cia_aberta_DRE_con_2024.csv": [
      CAB,
      `${P};DRE;REAL;MIL;PENÚLTIMO;2023-01-01;2023-12-31;3.01;x;511994000;S`,
      res("3.01", "490829000.0000000000"),
      res("3.03", "246462000"),
      res("3.05", "137201000"),
      res("3.11", "37009000"),
    ].join("\n"),
    "dfp_cia_aberta_BPA_con_2024.csv": [
      CAB_BP,
      bp("1", "1124797000"),
      bp("1.01", "135212000"),
      bp("1.01.01", "20254000"),
    ].join("\n"),
    "dfp_cia_aberta_BPP_con_2024.csv": [
      CAB_BP,
      bp("2.01", "194808000"),
      bp("2.01.04", "68783000"),
      bp("2.02.01", "304684000"),
      bp("2.03", "367514000"),
    ].join("\n"),
    "dfp_cia_aberta_DFC_MI_con_2024.csv": [
      CAB,
      fluxo("6.01.01.04", "Depreciação, depleção e amortização", "67033000"),
      fluxo("6.03.03", "Amortizações de principal", "-35933000"),
    ].join("\n"),
    "dfp_cia_aberta_composicao_capital_2024.csv":
      "CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;QT_ACAO_ORDIN_CAP_INTEGR;QT_ACAO_PREF_CAP_INTEGR;QT_ACAO_TOTAL_CAP_INTEGR;QT_ACAO_ORDIN_TESOURO;QT_ACAO_PREF_TESOURO;QT_ACAO_TOTAL_TESOURO\n" +
      "33.000.167/0001-01;2024-12-31;1;PETROBRAS;7442454142;5602042788;13044496930;222760;155541409;155764169",
  });
}

function itr2025() {
  const linha = (inicio: string, valor: string) =>
    `33.000.167/0001-01;2025-06-30;2;PETROBRAS;009512;DRE;REAL;MIL;ÚLTIMO;${inicio};2025-06-30;3.01;x;${valor};S`;
  return criarZip({
    // Acumulado e trimestre com a mesma conta e data-base: vale o trimestre.
    "itr_cia_aberta_DRE_con_2025.csv": [
      CAB,
      linha("2025-01-01", "242272000"),
      linha("2025-04-01", "119128000"),
    ].join("\n"),
  });
}

describe("CVM", () => {
  it("cadastro e FCA ligam o ticker a companhia", async () => {
    const cad =
      "CNPJ_CIA;DENOM_SOCIAL;DENOM_COMERC;DT_REG;CD_CVM;SETOR_ATIV;SIT;CONTROLE_ACIONARIO\n" +
      "33.000.167/0001-01;PETROLEO BRASILEIRO S.A. PETROBRAS;PETROBRAS;1977-07-20;9512;Petróleo e Gás;ATIVO;ESTATAL\n";
    const fca = await criarZip({
      "fca_cia_aberta_valor_mobiliario_2026.csv":
        "CNPJ_Companhia;Codigo_Negociacao\n33.000.167/0001-01;PETR4\n33.000.167/0001-01;PETR3\n",
    });
    const cvm = new CvmAdapter(
      buscarFalso({
        "cad_cia_aberta.csv": () => binario(Buffer.from(cad, "latin1")),
        "fca_cia_aberta_2026.zip": () => binario(fca),
      }),
    );
    const r = await carregarCadastro(db, cvm, { ano: 2026, log });
    expect(r.linhas).toBe(1);
    const [petr] = await db.select().from(assets).where(eq(assets.ticker, "PETR4"));
    expect(petr).toMatchObject({
      cnpj: "33000167000101",
      cvmCode: "009512",
      sector: "Petróleo e Gás",
    });
  });

  it("DFP grava, emite statement.published com os tickers e serve os fundamentos", async () => {
    const zip = await dfp2024();
    const cvm = new CvmAdapter(
      buscarFalso({ "dfp_cia_aberta_2024.zip": () => binario(zip) }),
    );
    const r = await carregarDemonstracoes(db, cvm, { tipo: "DFP", ano: 2024, log });
    expect(r.eventos).toBe(1);

    const [publicado] = await eventos("marketdata.statement.published.v1");
    expect(publicado?.payload).toEqual({
      cvm_code: "009512",
      tickers: ["PETR4"],
      period_end: "2024-12-31",
      statement_kind: "DFP",
    });

    const servico = criarServicoDeDados({
      db,
      brapi: new BrapiAdapter(buscarFalso({}), undefined, "https://b"),
      bcb: new BcbAdapter(buscarFalso({})),
      log,
    });
    const f = await servico.fundamentos("PETR4", "annual");
    expect(f.data.periods[0]).toMatchObject({
      reference_date: "2024-12-31",
      consolidated: true,
      revenue: "490829000000",
      net_income: "37009000000",
      gross_debt: "373467000000",
      depreciation_amortization: "67033000000",
      shares_outstanding: 12888732761,
    });
    expect(f.meta).toMatchObject({ source: "cvm-dfp", license: "ODbL-1.0" });
  });

  it("reprocessar o mesmo DFP nao emite de novo", async () => {
    const zip = await dfp2024();
    const cvm = new CvmAdapter(
      buscarFalso({ "dfp_cia_aberta_2024.zip": () => binario(zip) }),
    );
    expect(
      (await carregarDemonstracoes(db, cvm, { tipo: "DFP", ano: 2024, log })).pulado,
    ).toBe(true);
    expect(await eventos("marketdata.statement.published.v1")).toHaveLength(1);
  });

  it("ITR guarda o trimestre, nao o acumulado", async () => {
    const zip = await itr2025();
    const cvm = new CvmAdapter(
      buscarFalso({ "itr_cia_aberta_2025.zip": () => binario(zip) }),
    );
    await carregarDemonstracoes(db, cvm, { tipo: "ITR", ano: 2025, log });
    const servico = criarServicoDeDados({
      db,
      brapi: new BrapiAdapter(buscarFalso({}), undefined, "https://b"),
      bcb: new BcbAdapter(buscarFalso({})),
      log,
    });
    const f = await servico.fundamentos("PETR4", "quarterly");
    expect(f.data.periods[0]).toMatchObject({
      reference_date: "2025-06-30",
      period_start: "2025-04-01",
      revenue: "119128000000",
      statement_kind: "ITR",
    });
  });
});

// ---------------------------------------------------------------------------

describe("read-through", () => {
  let preco = 52.71;
  let falhar = false;
  const brapiFalsa = buscarFalso({
    "/quote/PETR4?dividends=true": () =>
      json({
        results: [
          {
            symbol: "PETR4",
            dividendsData: {
              cashDividends: [
                {
                  rate: 1,
                  label: "DIVIDENDO",
                  lastDatePrior: "2026-10-29T03:00:00.000Z",
                  exDate: "2026-10-30T03:00:00.000Z",
                  paymentDate: null,
                  approvedOn: null,
                },
                {
                  rate: 2,
                  label: "DIVIDENDO",
                  lastDatePrior: "2020-05-01T03:00:00.000Z",
                  exDate: null,
                  paymentDate: null,
                  approvedOn: null,
                },
              ],
              stockDividends: [],
            },
          },
        ],
      }),
    "/quote/PETR4": () =>
      falhar
        ? new Response("", { status: 503 })
        : json({
            results: [
              {
                symbol: "PETR4",
                regularMarketPrice: preco,
                regularMarketChange: 0.51,
                regularMarketChangePercent: 0.98,
                regularMarketTime: "2026-11-02T19:00:00.000Z",
              },
            ],
          }),
    "/quote/": () => json({ error: true }, 401),
  });

  let agora = new Date("2026-11-02T19:00:00Z");

  it("cotacao vai a fonte uma vez dentro do prazo e emite quote.updated", async () => {
    const s = criarServicoDeDados({
      db,
      brapi: new BrapiAdapter(brapiFalsa, undefined, "https://b"),
      bcb: new BcbAdapter(buscarFalso({})),
      log,
      agora: () => agora,
    });
    const antes = (await eventos("marketdata.quote.updated.v1")).length;
    const [a, b] = await Promise.all([s.cotacoes(["PETR4"]), s.cotacoes(["PETR4"])]);
    expect(a.data[0]).toMatchObject({ price: "52.71", stale: false });
    expect(b.data[0]?.price).toBe("52.71");
    expect(brapiFalsa.chamadas.filter((u) => u.endsWith("/quote/PETR4"))).toHaveLength(1);
    expect(a.meta).toMatchObject({ source: "brapi", delay_minutes: 15 });
    expect(await eventos("marketdata.quote.updated.v1")).toHaveLength(antes + 1);

    // Prazo vencido, mesmo preco: le de novo, mas nao emite.
    agora = new Date(agora.getTime() + 120_000);
    await s.cotacoes(["PETR4"]);
    expect(await eventos("marketdata.quote.updated.v1")).toHaveLength(antes + 1);

    // Fonte fora: serve o ultimo valor marcado como stale.
    agora = new Date(agora.getTime() + 120_000);
    falhar = true;
    const r = await s.cotacoes(["PETR4"]);
    expect(r.data[0]).toMatchObject({ price: "52.71", stale: true });
    expect(r.meta.stale).toBe(true);
    falhar = false;
    preco = 53.1;
  });

  it("sem brapi, cai no ultimo fechamento do COTAHIST", async () => {
    const s = criarServicoDeDados({
      db,
      brapi: new BrapiAdapter(brapiFalsa, undefined, "https://b"),
      bcb: new BcbAdapter(buscarFalso({})),
      log,
      agora: () => agora,
    });
    const r = await s.cotacoes(["BOVA11"]);
    expect(r.data[0]).toMatchObject({ price: "165.4", change: "-1.11", stale: true });
    expect(r.meta).toMatchObject({ source: "b3-cotahist", delay_minutes: 1440 });
    await expect(s.cotacoes(["NADA3"])).rejects.toMatchObject({ code: "not_found" });
    await expect(
      s.cotacoes(Array.from({ length: 21 }, (_, i) => `TK${i}A`)),
    ).rejects.toMatchObject({
      code: "too_many_tickers",
    });
  });

  it("proventos: so o recente vira dividend.announced, e o historico ajusta", async () => {
    const s = criarServicoDeDados({
      db,
      brapi: new BrapiAdapter(brapiFalsa, undefined, "https://b"),
      bcb: new BcbAdapter(buscarFalso({})),
      log,
      agora: () => agora,
    });
    const p = await s.proventos("PETR4", {});
    expect(p.data.map((d) => [d.ex_date, d.value_per_share])).toEqual([
      ["2026-10-30", "1"],
      ["2020-05-02", "2"],
    ]);
    const anunciados = await eventos("marketdata.dividend.announced.v1");
    expect(anunciados.map((e) => (e.payload as { ex_date: string }).ex_date)).toEqual([
      "2026-10-30",
    ]);

    // Dividendo de 1 com data-ex 30/10: o fechamento de 29/10 (50) vira 49.
    const h = await s.historico("PETR4", {
      interval: "1d",
      adjusted: true,
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(h.data.candles.map((c) => c.close)).toEqual(["49", "52"]);
    const bruto = await s.historico("PETR4", {
      interval: "1d",
      adjusted: false,
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(bruto.data.candles.map((c) => c.close)).toEqual(["50", "52"]);
  });

  it("proventos recusados pela fonte ficam em cache negativo", async () => {
    const s = criarServicoDeDados({
      db,
      brapi: new BrapiAdapter(brapiFalsa, undefined, "https://b"),
      bcb: new BcbAdapter(buscarFalso({})),
      log,
      agora: () => agora,
    });
    const r = await s.proventos("BOVA11", {});
    expect(r.meta.stale).toBe(true);
    const antes = brapiFalsa.chamadas.length;
    await s.proventos("BOVA11", {});
    expect(brapiFalsa.chamadas.length).toBe(antes);
  });

  it("macro le o SGS uma vez e IBOV sem token usa o BOVA11", async () => {
    const bcbFalso = buscarFalso({
      "bcdata.sgs.12": () => json([{ data: "30/10/2026", valor: "0.050788" }]),
    });
    const s = criarServicoDeDados({
      db,
      brapi: new BrapiAdapter(brapiFalsa, undefined, "https://b"),
      bcb: new BcbAdapter(bcbFalso, "https://bcb"),
      log,
      agora: () => agora,
    });
    const cdi = await s.macro("cdi", { from: "2026-10-01", to: "2026-10-31" });
    expect(cdi.data.points).toEqual([{ date: "2026-10-30", value: "0.050788" }]);
    const chamadas = bcbFalso.chamadas.length;
    await s.macro("cdi", { from: "2026-10-01", to: "2026-10-31" });
    expect(bcbFalso.chamadas.length).toBe(chamadas);

    const ibov = await s.macro("ibov", { from: "2026-10-01", to: "2026-10-31" });
    expect(ibov.data.points).toEqual([
      { date: "2026-10-29", value: "166.51" },
      { date: "2026-10-30", value: "165.4" },
    ]);
    expect(ibov.meta.source).toBe("b3-cotahist:BOVA11");
  });

  it("busca ordena ticker exato primeiro", async () => {
    const s = criarServicoDeDados({
      db,
      brapi: new BrapiAdapter(brapiFalsa, undefined, "https://b"),
      bcb: new BcbAdapter(buscarFalso({})),
      log,
    });
    const r = await s.buscarAtivos("petr4");
    expect(r.data[0]).toMatchObject({ ticker: "PETR4", sector: "Petróleo e Gás" });
    expect((await s.buscarAtivos("bova", "stock")).data).toEqual([]);
    expect((await db.select().from(quotesDaily)).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("fundos", () => {
  it("cadastro, informe diario e leitura pelo servico", async () => {
    const registro = await criarZip({
      "registro_classe.csv":
        "CNPJ_Classe;Tipo_Classe;Denominacao_Social;Situacao;Classificacao;Classificacao_Anbima;Patrimonio_Liquido;Data_Patrimonio_Liquido\n" +
        "00017024000153;Classes de Cotas de Fundos FIF;VERDE FIC FIM;Em Funcionamento Normal;Multimercado;;1214792.63;2026-09-30\n",
    });
    const linhas = ["2026-09-01;44.6", "2026-09-02;45.0", "2026-09-03;44.1"].map((x) => {
      const [dia, cota] = x.split(";");
      return `CLASSES - FIF;00.017.024/0001-53;;${dia};1;${cota};1214792.63;0;0;10`;
    });
    const informe = await criarZip({
      "inf_diario_fi_202609.csv":
        "TP_FUNDO_CLASSE;CNPJ_FUNDO_CLASSE;ID_SUBCLASSE;DT_COMPTC;VL_TOTAL;VL_QUOTA;VL_PATRIM_LIQ;CAPTC_DIA;RESG_DIA;NR_COTST\n" +
        linhas.join("\n"),
    });
    const cvm = new CvmAdapter(
      buscarFalso({
        "registro_fundo_classe.zip": () => binario(registro),
        "inf_diario_fi_202609.zip": () => binario(informe),
      }),
    );
    expect((await carregarCadastroDeFundos(db, cvm, { log })).linhas).toBe(1);
    expect((await carregarInformeDiario(db, cvm, { aaaamm: "202609", log })).linhas).toBe(
      3,
    );
    expect((await carregarInformeDiario(db, cvm, { aaaamm: "202609", log })).pulado).toBe(
      true,
    );
    expect((await carregarInformeDiario(db, cvm, { aaaamm: "209901", log })).pulado).toBe(
      true,
    );

    const s = criarServicoDeDados({
      db,
      brapi: new BrapiAdapter(buscarFalso({}), undefined, "https://b"),
      bcb: new BcbAdapter(buscarFalso({})),
      log,
      agora: () => new Date("2026-09-04T12:00:00Z"),
    });
    expect((await s.buscarFundos("verde")).data[0]).toMatchObject({
      cnpj: "00017024000153",
      name: "VERDE FIC FIM",
    });
    expect((await s.buscarFundos("00.017.024")).data).toHaveLength(1);
    expect((await s.fundo("00017024000153")).data).toMatchObject({
      aum: "1214792.63",
      status: "Em Funcionamento Normal",
    });
    const h = await s.historicoDeFundo("00017024000153", { from: "2026-09-01" });
    expect(h.data.points.map((p) => p.nav)).toEqual(["44.6", "45", "44.1"]);
    expect(h.meta).toMatchObject({
      source: "cvm-fundos",
      license: "ODbL-1.0",
      stale: false,
    });
    await expect(s.historicoDeFundo("99999999000199", {})).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(s.fundo("99999999000199")).rejects.toMatchObject({ code: "not_found" });
  });

  it("ultimos meses", () => {
    expect(ultimosMeses("2026-02-10", 3)).toEqual(["202512", "202601", "202602"]);
  });
});

// ---------------------------------------------------------------------------

describe("informe mensal de FII", () => {
  const cabGeral =
    "Tipo_Fundo_Classe;CNPJ_Fundo_Classe;Data_Referencia;Versao;Nome_Fundo_Classe;Codigo_ISIN;Quantidade_Cotas_Emitidas;Segmento_Atuacao\n";
  const cabComplemento =
    "CNPJ_Fundo_Classe;Data_Referencia;Versao;Total_Numero_Cotistas;Valor_Ativo;Patrimonio_Liquido;Cotas_Emitidas;Valor_Patrimonial_Cotas;Percentual_Rentabilidade_Efetiva_Mes;Percentual_Dividend_Yield_Mes;Percentual_Amortizacao_Cotas_Mes\n";
  const zipDoAno = (versaoDeSetembro: number, dySetembro: string) =>
    criarZip({
      "inf_mensal_fii_geral_2026.csv":
        cabGeral +
        "FII;11.728.688/0001-47;2026-08-01;1;PATRIA LOG FII;BRHGLGCTF004;45601713;Logistica\n" +
        `FII;11.728.688/0001-47;2026-09-01;${versaoDeSetembro};PATRIA LOG FII;BRHGLGCTF004;45601713;Logistica\n` +
        "FII;03.855.441/0001-63;2026-09-01;1;RB LOGISTICA FII;;144210661;\n",
      "inf_mensal_fii_complemento_2026.csv":
        cabComplemento +
        "11.728.688/0001-47;2026-08-01;1;608345;8850561499.23;7567668488.14;45601713;165.951408188109;0.004143;0.007027;0\n" +
        `11.728.688/0001-47;2026-09-01;${versaoDeSetembro};613837;8835655334.84;7546017797.39;45601713;165.476630173739;0.004191;${dySetembro};0\n`,
      "inf_mensal_fii_ativo_passivo_2026.csv":
        "CNPJ_Fundo_Classe;Data_Referencia;Versao;Rendimentos_Distribuir\n",
    });

  it("grava, liga o ticker pelo ISIN, emite e serve pelo /v1", async () => {
    const cotahist = await criarZip({
      "COTAHIST_A2025.TXT": linhaCotahist({
        data: "2025-12-30",
        ticker: "HGLG11",
        codbdi: "12",
        especi: "CI",
        fechamento: 158.2,
        isin: "BRHGLGCTF004",
      }),
    });
    const b3 = new B3CotahistAdapter(
      buscarFalso({ COTAHIST_A2025: () => binario(cotahist) }),
      "https://b3",
    );
    await carregarCotahist(db, (await b3.ano(2025))!, { diario: false, log });

    const zip = await zipDoAno(1, "0.007052");
    const cvm = new CvmAdapter(
      buscarFalso({ "inf_mensal_fii_2026.zip": () => binario(zip) }),
    );
    expect(await carregarInformeFii(db, cvm, { ano: 2026, log })).toEqual({
      pulado: false,
      linhas: 3,
      eventos: 1,
    });
    const [hglg] = await db.select().from(assets).where(eq(assets.ticker, "HGLG11"));
    expect(hglg?.cnpj).toBe("11728688000147");

    // Um evento por fundo com ticker, com a competencia mais recente. O fundo
    // sem ISIN fica de fora.
    const publicados = await eventos("marketdata.fii.report.published.v1");
    expect(publicados.map((e) => e.payload)).toEqual([
      { cnpj: "11728688000147", tickers: ["HGLG11"], reference_date: "2026-09-01" },
    ]);
    expect((await carregarInformeFii(db, cvm, { ano: 2026, log })).pulado).toBe(true);

    const s = criarServicoDeDados({
      db,
      brapi: new BrapiAdapter(buscarFalso({}), undefined, "https://b"),
      bcb: new BcbAdapter(buscarFalso({})),
      log,
      agora: () => new Date("2026-10-20T12:00:00Z"),
    });
    const r = await s.informesFii("HGLG11", {});
    expect(r.data).toMatchObject({ cnpj: "11728688000147", segment: "Logistica" });
    expect(r.data.reports.map((x) => x.reference_date)).toEqual([
      "2026-08-01",
      "2026-09-01",
    ]);
    expect(r.data.reports[1]).toMatchObject({
      equity: "7546017797.39",
      // numeric(20,6): o VP da cota fica com seis casas.
      nav_per_share: "165.47663",
      holders: 613837,
      dividend_yield_month: "0.007052",
      provenance: { source: "cvm-fii-mensal", license: "ODbL-1.0" },
    });
    expect(r.meta).toMatchObject({ source: "cvm-fii-mensal", stale: false });
    await expect(s.informesFii("PETR4", {})).rejects.toMatchObject({ code: "not_found" });
  });

  it("reapresentacao com versao maior substitui e emite de novo", async () => {
    const zip = await zipDoAno(2, "0.0071");
    const cvm = new CvmAdapter(
      buscarFalso({ "inf_mensal_fii_2026.zip": () => binario(zip) }),
    );
    expect((await carregarInformeFii(db, cvm, { ano: 2026, log })).eventos).toBe(1);
    expect(await eventos("marketdata.fii.report.published.v1")).toHaveLength(2);
    const s = criarServicoDeDados({
      db,
      brapi: new BrapiAdapter(buscarFalso({}), undefined, "https://b"),
      bcb: new BcbAdapter(buscarFalso({})),
      log,
    });
    const r = await s.informesFii("HGLG11", { from: "2026-09-01" });
    expect(r.data.reports).toMatchObject([
      { version: 2, dividend_yield_month: "0.0071" },
    ]);
  });
});
