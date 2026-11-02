import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BolsiqError } from "@bolsiq/contracts";
import {
  binario,
  buscarFalso,
  criarZip,
  json,
  linhaCotahist,
} from "../testes/fixtures.js";
import { B3CotahistAdapter } from "./b3-cotahist.js";
import { BcbAdapter } from "./bcb.js";
import { BrapiAdapter, dataEmSaoPaulo, multiplicadorDeAcoes } from "./brapi.js";
import { CvmAdapter, normalizarCodigoCvm } from "./cvm.js";
import { baixarParaArquivo, obter } from "./http.js";
import { linhasDoZip } from "./zip.js";

describe("http", () => {
  it("erro de rede vira source_unavailable", async () => {
    const buscar = () => Promise.reject(new Error("ECONNREFUSED"));
    await expect(obter(buscar, "https://x")).rejects.toMatchObject({
      code: "source_unavailable",
    });
  });

  it("5xx vira source_unavailable e 4xx passa adiante", async () => {
    await expect(
      obter(() => Promise.resolve(new Response("", { status: 502 })), "https://x"),
    ).rejects.toBeInstanceOf(BolsiqError);
    const r = await obter(
      () => Promise.resolve(new Response("", { status: 401 })),
      "https://x",
    );
    expect(r.status).toBe(401);
  });

  it("baixa para arquivo com hash e devolve null em 404", async () => {
    const buscar = buscarFalso({
      "https://a/arq.zip": () => binario(Buffer.from("abc")),
    });
    const r = await baixarParaArquivo(buscar, "https://a/arq.zip");
    expect(r?.bytes).toBe(3);
    expect(r?.sha256).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await readFile(r?.caminho as string, "utf8")).toBe("abc");
    expect(await baixarParaArquivo(buscar, "https://a/outro.zip")).toBeNull();
  });

  it("download com status inesperado falha", async () => {
    const buscar = buscarFalso({ "https://a": () => new Response("", { status: 403 }) });
    await expect(baixarParaArquivo(buscar, "https://a/x.zip")).rejects.toMatchObject({
      code: "source_unavailable",
    });
  });
});

describe("zip", () => {
  it("le linhas em latin1 das entradas aceitas", async () => {
    const zip = await criarZip({ "a.csv": "ÚLTIMO\r\nlinha 2", "b.txt": "fora" });
    const buscar = buscarFalso({ "https://z": () => binario(zip) });
    const arq = await baixarParaArquivo(buscar, "https://z/x.zip");
    const linhas: string[] = [];
    for await (const l of linhasDoZip(arq?.caminho as string, (n) =>
      n.endsWith(".csv"),
    )) {
      linhas.push(`${l.entrada}:${l.linha}`);
    }
    expect(linhas).toEqual(["a.csv:ÚLTIMO", "a.csv:linha 2"]);
  });
});

describe("BrapiAdapter", () => {
  const resultado = {
    symbol: "PETR4",
    regularMarketPrice: 52.71,
    regularMarketChange: 0.51,
    regularMarketChangePercent: 0.98,
    regularMarketPreviousClose: 52.2,
    regularMarketOpen: 52.45,
    regularMarketDayHigh: 53.66,
    regularMarketDayLow: 52.36,
    regularMarketVolume: 61743200,
    regularMarketTime: "2026-11-02T19:00:30.000Z",
    dividendsData: {
      cashDividends: [
        {
          rate: 0.20250435,
          label: "JCP",
          lastDatePrior: "2026-08-21T03:00:00.000Z",
          exDate: "2026-08-24T03:00:00.000Z",
          paymentDate: "2026-12-21T03:00:00.000Z",
          approvedOn: "2026-08-06T03:00:00.000Z",
        },
        {
          rate: 1,
          label: "DIVIDENDO",
          lastDatePrior: "2025-05-02T03:00:00.000Z",
          exDate: null,
          paymentDate: null,
          approvedOn: null,
        },
        {
          rate: 1,
          label: "DESCONHECIDO",
          lastDatePrior: null,
          paymentDate: null,
          approvedOn: null,
        },
      ],
      stockDividends: [
        {
          factor: 2,
          completeFactor: "2 para 1",
          label: "DESDOBRAMENTO",
          lastDatePrior: "2008-04-25T03:00:00.000Z",
          exDate: null,
          approvedOn: "2008-04-25T03:00:00.000Z",
        },
        {
          factor: 1,
          completeFactor: "1 para 1",
          label: "CIS RED CAP",
          lastDatePrior: null,
          approvedOn: null,
        },
      ],
    },
    historicalDataPrice: [
      { date: 1793638800, open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
      { date: 1793725200, open: null, high: null, low: null, close: null, volume: null },
    ],
  };

  it("converte preco para string decimal sem passar por aritmetica", async () => {
    const brapi = new BrapiAdapter(
      buscarFalso({ "/quote/PETR4": () => json({ results: [resultado] }) }),
      undefined,
      "https://b",
    );
    const c = await brapi.cotacao("PETR4");
    expect(c).toMatchObject({
      price: "52.71",
      change: "0.51",
      changePercent: "0.98",
      previousClose: "52.2",
      volume: 61743200n,
      quotedAt: "2026-11-02T19:00:30.000Z",
    });
  });

  it("ticker fora do plano (401) e o mesmo que sem dado", async () => {
    const brapi = new BrapiAdapter(
      buscarFalso({ "/quote/": () => json({ error: true }, 401) }),
      undefined,
      "https://b",
    );
    expect(await brapi.cotacao("WEGE3")).toBeNull();
    expect(await brapi.proventos("WEGE3")).toBeNull();
  });

  it("429 e outros erros viram source_unavailable", async () => {
    const limite = new BrapiAdapter(
      buscarFalso({ "/quote/": () => json({}, 429) }),
      "t",
      "https://b",
    );
    await expect(limite.cotacao("PETR4")).rejects.toMatchObject({
      code: "source_unavailable",
    });
    const outro = new BrapiAdapter(
      buscarFalso({ "/quote/": () => json({}, 400) }),
      "t",
      "https://b",
    );
    await expect(outro.cotacao("PETR4")).rejects.toMatchObject({
      code: "source_unavailable",
    });
  });

  it("envia o token quando configurado", async () => {
    let cabecalho = "";
    const brapi = new BrapiAdapter(
      (_url, init) => {
        cabecalho = new Headers(init?.headers).get("authorization") ?? "";
        return Promise.resolve(json({ results: [] }));
      },
      "segredo",
      "https://b",
    );
    expect(await brapi.cotacao("PETR4")).toBeNull();
    expect(cabecalho).toBe("Bearer segredo");
  });

  it("mapeia proventos, data-ex e eventos de acoes", async () => {
    const brapi = new BrapiAdapter(
      buscarFalso({ "/quote/PETR4": () => json({ results: [resultado] }) }),
      undefined,
      "https://b",
    );
    const p = await brapi.proventos("PETR4");
    expect(p).toEqual([
      expect.objectContaining({
        kind: "jcp",
        exDate: "2026-08-24",
        paymentDate: "2026-12-21",
        valuePerShare: "0.20250435",
      }),
      // Sem exDate, a data-ex e o dia seguinte a data-com.
      expect.objectContaining({
        kind: "dividendo",
        exDate: "2025-05-03",
        paymentDate: null,
      }),
      expect.objectContaining({
        kind: "desdobramento",
        factor: "2",
        ratio: "2 para 1",
        valuePerShare: null,
      }),
    ]);
  });

  it("historico diario descarta pregao sem fechamento", async () => {
    const brapi = new BrapiAdapter(
      buscarFalso({ "/quote/%5EBVSP": () => json({ results: [resultado] }) }),
      "t",
      "https://b",
    );
    const h = await brapi.historico("^BVSP", "1y");
    expect(h).toHaveLength(1);
    expect(h?.[0]).toMatchObject({ close: "10.5", open: "10", volume: 100 });
    const vazio = new BrapiAdapter(
      buscarFalso({ "/quote/": () => json({ results: [{ symbol: "X" }] }) }),
      "t",
      "https://b",
    );
    expect(await vazio.historico("X", "1y")).toBeNull();
  });

  it("data no fuso de Sao Paulo e multiplicador valido", () => {
    expect(dataEmSaoPaulo("2026-08-21T03:00:00.000Z")).toBe("2026-08-21");
    expect(dataEmSaoPaulo("2026-08-21T02:00:00.000Z")).toBe("2026-08-20");
    expect(multiplicadorDeAcoes(1.1)).toBe("1.1");
    expect(multiplicadorDeAcoes(0)).toBeNull();
  });
});

describe("BcbAdapter", () => {
  it("fatia em janelas, pula janela vazia e converte data", async () => {
    let n = 0;
    const bcb = new BcbAdapter(
      buscarFalso({
        "bcdata.sgs.12": () => {
          n++;
          return n === 1
            ? json([{ data: "02/01/2020", valor: "0.017089" }])
            : new Response("", { status: 404 });
        },
      }),
      "https://bcb",
    );
    const pontos = await bcb.serie("12", "2020-01-01", "2024-12-31");
    expect(n).toBe(2);
    expect(pontos).toEqual([{ date: "2020-01-02", value: "0.017089" }]);
  });

  it("status inesperado falha", async () => {
    const bcb = new BcbAdapter(
      buscarFalso({ bcdata: () => json({}, 406) }),
      "https://bcb",
    );
    await expect(bcb.serie("12", "2024-01-01", "2024-02-01")).rejects.toMatchObject({
      code: "source_unavailable",
    });
  });
});

describe("B3CotahistAdapter", () => {
  it("le so o universo a vista e classifica o tipo", async () => {
    const texto = [
      `00COTAHIST.2024BOVESPA 20240102${" ".repeat(212)}`,
      linhaCotahist({ data: "2024-01-02", ticker: "PETR4", fechamento: 38.42 }),
      linhaCotahist({
        data: "2024-01-02",
        ticker: "HGLG11",
        codbdi: "12",
        especi: "CI",
        fechamento: 160,
      }),
      linhaCotahist({
        data: "2024-01-02",
        ticker: "PETRA380",
        codbdi: "78",
        tpmerc: "070",
        fechamento: 1,
      }),
      linhaCotahist({
        data: "2024-01-02",
        ticker: "PETR4F",
        codbdi: "96",
        tpmerc: "020",
        fechamento: 38,
      }),
      `99COTAHIST.2024${" ".repeat(230)}`,
    ].join("\r\n");
    const zip = await criarZip({ "COTAHIST_A2024.TXT": texto });
    const buscar = buscarFalso({ "COTAHIST_A2024.ZIP": () => binario(zip) });
    const arq = await new B3CotahistAdapter(buscar, "https://b3").ano(2024);
    const registros = [];
    for await (const r of arq?.registros() ?? []) registros.push(r);
    expect(registros.map((r) => [r.ticker, r.kind, r.close, r.classe])).toEqual([
      ["PETR4", "stock", "38.42", "PN"],
      ["HGLG11", "fii", "160", "CI"],
    ]);
    expect(arq?.sourceRef).toBe("COTAHIST_A2024.ZIP");
  });

  it("dia sem pregao devolve null", async () => {
    const adapter = new B3CotahistAdapter(buscarFalso({}), "https://b3");
    expect(await adapter.dia("2024-12-25")).toBeNull();
  });
});

describe("CvmAdapter", () => {
  const cad =
    "CNPJ_CIA;DENOM_SOCIAL;DENOM_COMERC;DT_REG;CD_CVM;SETOR_ATIV;SIT;CONTROLE_ACIONARIO\n" +
    "33.000.167/0001-01;PETROLEO BRASILEIRO S.A. PETROBRAS;PETROBRAS;1977-07-20;9512;Petróleo e Gás;ATIVO;ESTATAL\n" +
    "invalido;X;;;1;;;\n" +
    "\n";

  it("le o cadastro em latin1 com codigo CVM de seis digitos", async () => {
    const buscar = buscarFalso({
      "cad_cia_aberta.csv": () => binario(Buffer.from(cad, "latin1")),
    });
    const { companhias, arquivo } = await new CvmAdapter(buscar).cadastro();
    expect(companhias).toEqual([
      expect.objectContaining({
        cnpj: "33000167000101",
        cvmCode: "009512",
        name: "PETROBRAS",
        sector: "Petróleo e Gás",
      }),
    ]);
    expect(arquivo.sha256).toHaveLength(64);
    expect(normalizarCodigoCvm("9512")).toBe("009512");
  });

  it("cadastro fora do ar vira source_unavailable", async () => {
    const fora = new CvmAdapter(() => Promise.reject(new Error("timeout")));
    await expect(fora.cadastro()).rejects.toMatchObject({ code: "source_unavailable" });
    const erro = new CvmAdapter(
      buscarFalso({ cad_: () => new Response("", { status: 500 }) }),
    );
    await expect(erro.cadastro()).rejects.toMatchObject({ code: "source_unavailable" });
  });

  it("le tickers do FCA", async () => {
    const vm =
      "CNPJ_Companhia;Valor_Mobiliario;Codigo_Negociacao\n" +
      "33.000.167/0001-01;Ações Ordinárias;PETR3\n" +
      "33.000.167/0001-01;Debêntures;\n" +
      "33.000.167/0001-01;Ações Preferenciais;petr4\n";
    const zip = await criarZip({
      "fca_cia_aberta_valor_mobiliario_2025.csv": vm,
      "fca_cia_aberta_2025.csv": "x",
    });
    const cvm = new CvmAdapter(
      buscarFalso({ "fca_cia_aberta_2025.zip": () => binario(zip) }),
    );
    expect(await cvm.valoresMobiliarios(2025)).toEqual([
      { cnpj: "33000167000101", ticker: "PETR3" },
      { cnpj: "33000167000101", ticker: "PETR4" },
    ]);
    expect(await cvm.valoresMobiliarios(2030)).toBeNull();
  });

  it("filtra ULTIMO, aplica a escala e marca consolidado", async () => {
    const cab =
      "CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;GRUPO_DFP;MOEDA;ESCALA_MOEDA;ORDEM_EXERC;DT_INI_EXERC;DT_FIM_EXERC;CD_CONTA;DS_CONTA;VL_CONTA;ST_CONTA_FIXA";
    const dre =
      `${cab}\n` +
      "33.000.167/0001-01;2024-12-31;1;PETROBRAS;009512;DRE;REAL;MIL;PENÚLTIMO;2023-01-01;2023-12-31;3.01;Receita;511994000.0000000000;S\n" +
      "33.000.167/0001-01;2024-12-31;1;PETROBRAS;009512;DRE;REAL;MIL;ÚLTIMO;2024-01-01;2024-12-31;3.01;Receita;490829000.0000000000;S\n";
    const bpp =
      "CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;GRUPO_DFP;MOEDA;ESCALA_MOEDA;ORDEM_EXERC;DT_FIM_EXERC;CD_CONTA;DS_CONTA;VL_CONTA;ST_CONTA_FIXA\n" +
      "33.000.167/0001-01;2024-12-31;1;PETROBRAS;009512;BPP;REAL;MIL;ÚLTIMO;2024-12-31;2.03;PL;367514000.0000000000;S\n";
    const comp =
      "CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;QT_ACAO_ORDIN_CAP_INTEGR;QT_ACAO_PREF_CAP_INTEGR;QT_ACAO_TOTAL_CAP_INTEGR;QT_ACAO_ORDIN_TESOURO;QT_ACAO_PREF_TESOURO;QT_ACAO_TOTAL_TESOURO\n" +
      "33.000.167/0001-01;2024-12-31;1;PETROBRAS;7442454142;5602042788;13044496930;222760;155541409;155764169\n";
    const zip = await criarZip({
      "dfp_cia_aberta_DRE_con_2024.csv": dre,
      "dfp_cia_aberta_BPP_ind_2024.csv": bpp,
      "dfp_cia_aberta_DMPL_con_2024.csv": "ignorado",
      "dfp_cia_aberta_composicao_capital_2024.csv": comp,
    });
    const cvm = new CvmAdapter(
      buscarFalso({ "dfp_cia_aberta_2024.zip": () => binario(zip) }),
    );
    const arq = await cvm.demonstracoes("DFP", 2024);
    const linhas = [];
    for await (const l of arq?.linhas() ?? []) linhas.push(l);
    expect(linhas).toEqual([
      expect.objectContaining({
        statementType: "DRE",
        isConsolidated: true,
        amount: "490829000000",
        periodStart: "2024-01-01",
        sourceRef: "dfp_cia_aberta_2024.zip#dfp_cia_aberta_DRE_con_2024.csv",
      }),
      expect.objectContaining({
        statementType: "BPP",
        isConsolidated: false,
        periodStart: null,
      }),
    ]);
    const acoes = [];
    for await (const c of arq?.composicao() ?? []) acoes.push(c);
    expect(acoes[0]).toMatchObject({ total: 13044496930n, treasuryTotal: 155764169n });
    expect(await cvm.demonstracoes("ITR", 2024)).toBeNull();
  });
});
