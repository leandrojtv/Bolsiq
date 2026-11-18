import { describe, expect, it } from "vitest";
import { alocar, CLASSE_DE_ALOCACAO } from "./alocacao.js";
import { apurar } from "./posicao.js";
import {
  CargaRecusada,
  dataBr,
  revisarCarga,
  transacoesDaCarga,
  type BaseDaCarga,
} from "./posicao-carga.js";
import { COLUNAS_POSICAO, importarPosicaoBolsiq } from "./posicao-csv.js";
import { fluxoDaTransacao, snapshotsDiarios } from "./snapshot.js";
import type { Transacao } from "./tipos.js";

const vazia: BaseDaCarga = { transacoes: [], vigentes: [], cargas: [] };

function arquivo(...linhas: Partial<Record<(typeof COLUNAS_POSICAO)[number], string>>[]) {
  return importarPosicaoBolsiq(
    [
      COLUNAS_POSICAO.join(","),
      ...linhas.map((campos) => {
        const base = {
          data_posicao: "2026-11-05",
          corretora: "XP",
          classe: "outro",
          ativo: "A",
          saldo_bruto: "100",
          valorizacao: "manual",
          ...campos,
        } as Record<string, string>;
        return COLUNAS_POSICAO.map((c) => base[c] ?? "").join(",");
      }),
    ].join("\n"),
  );
}
const acao = (codigo: string, quantidade: string, extra = {}) => ({
  classe: "acao",
  ativo: codigo,
  codigo,
  quantidade,
  preco_unitario: "40",
  preco_medio: "30",
  ...extra,
});
const tx = (p: Partial<Transacao>): Transacao => ({
  id: `t-${Math.random()}`,
  ticker: "PETR4",
  tipo: "compra",
  data: "2026-01-02",
  quantidade: "30",
  preco: "10",
  taxas: "0",
  corretora: "XP",
  ...p,
});

describe("saldo_inicial", () => {
  const inicial = tx({ tipo: "saldo_inicial", quantidade: "85", preco: "41.16" });

  it("entra no custo e no preco medio, como compra", () => {
    const [p] = apurar([inicial]).posicoes;
    expect(p?.quantidade).toBe("85.00000000");
    expect(p?.preco_medio).toBe("41.160000");
    expect(p?.custo_total).toBe("3498.60");

    const [depois] = apurar([
      inicial,
      tx({ data: "2026-02-01", quantidade: "15", preco: "50" }),
    ]).posicoes;
    expect(depois?.quantidade).toBe("100.00000000");
    expect(depois?.preco_medio).toBe("42.486000");
  });

  it("e fluxo de aporte na data, nao rende no TWR", () => {
    expect(fluxoDaTransacao(inicial).toString()).toBe("3498.6");

    // Aporte no dia 2 ao mesmo preco: retorno zero, sem salto na serie.
    const serie = snapshotsDiarios(
      [
        tx({ data: "2026-01-02", quantidade: "10", preco: "10" }),
        tx({ tipo: "saldo_inicial", data: "2026-01-03", quantidade: "10", preco: "10" }),
      ],
      {
        PETR4: [
          { date: "2026-01-02", close: "10" },
          { date: "2026-01-03", close: "10" },
        ],
      },
      ["2026-01-02", "2026-01-03"],
    );
    expect(serie[1]?.fluxo_caixa).toBe("100.00");
    expect(serie[1]?.valor_bruto).toBe("200.00");
    expect(serie[1]?.retorno_twr).toBe(0);
  });
});

describe("revisarCarga, renda variavel", () => {
  it("sem transacao do ticker na corretora, prevê saldo inicial ao preco medio", () => {
    const r = revisarCarga(arquivo(acao("ITUB4", "85")), vazia);
    expect(r.saldos_iniciais).toEqual([
      {
        corretora: "XP",
        ticker: "ITUB4",
        quantidade: "85",
        preco: "30",
        data_posicao: "2026-11-05",
      },
    ]);
    expect(r.divergencias).toEqual([]);
    expect(r.novas).toEqual([]);
    expect(r.linhas_aceitas).toBe(1);

    expect(transacoesDaCarga(r, [])[0]).toMatchObject({
      tipo: "saldo_inicial",
      ticker: "ITUB4",
      quantidade: "85",
      preco: "30",
      data: "2026-11-05",
      corretora: "XP",
    });
  });

  it("sem preco medio, custo pelo valor aplicado; sem ele, pelo preco do extrato", () => {
    const porValor = revisarCarga(
      arquivo(acao("ITUB4", "10", { preco_medio: "", valor_aplicado: "250" })),
      vazia,
    );
    expect(porValor.saldos_iniciais[0]?.preco).toBe("25.000000");
    const porExtrato = revisarCarga(
      arquivo(acao("ITUB4", "10", { preco_medio: "" })),
      vazia,
    );
    expect(porExtrato.saldos_iniciais[0]?.preco).toBe("40");
  });

  it("quantidade zero nao gera saldo inicial", () => {
    expect(revisarCarga(arquivo(acao("ITUB4", "0")), vazia).saldos_iniciais).toEqual([]);
  });

  it("transacao em outra corretora nao impede o saldo inicial", () => {
    const r = revisarCarga(arquivo(acao("PETR4", "33")), {
      ...vazia,
      transacoes: [tx({ corretora: "Clear" })],
    });
    expect(r.saldos_iniciais).toHaveLength(1);
  });

  it("transacao sem corretora conta: extrato da B3 nao dobra a posicao", () => {
    const r = revisarCarga(arquivo(acao("PETR4", "30")), {
      ...vazia,
      transacoes: [tx({ corretora: undefined })],
    });
    expect(r.saldos_iniciais).toEqual([]);
    expect(r.divergencias).toEqual([]);
  });

  it("mesma quantidade nao diverge, e nome da corretora ignora caixa", () => {
    const r = revisarCarga(arquivo(acao("PETR4", "30")), {
      ...vazia,
      transacoes: [tx({ corretora: "xp" })],
    });
    expect(r.saldos_iniciais).toEqual([]);
    expect(r.divergencias).toEqual([]);
  });

  it("extrato maior vira compra ao preco unitario, so se o usuario pedir", () => {
    const r = revisarCarga(arquivo(acao("PETR4", "33")), {
      ...vazia,
      transacoes: [tx({})],
    });
    expect(r.divergencias).toEqual([
      {
        corretora: "XP",
        ticker: "PETR4",
        sistema: "30",
        extrato: "33",
        ajuste: { tipo: "compra", quantidade: "3", preco: "40" },
        data_posicao: "2026-11-05",
      },
    ]);
    expect(transacoesDaCarga(r, [])).toEqual([]);
    expect(
      transacoesDaCarga(r, [{ corretora: "XP", ticker: "PETR4", acao: "ignorar" }]),
    ).toEqual([]);
    expect(
      transacoesDaCarga(r, [
        { corretora: "XP", ticker: "PETR4", acao: "gerar_ajuste" },
      ])[0],
    ).toMatchObject({ tipo: "compra", quantidade: "3", preco: "40", data: "2026-11-05" });
  });

  it("extrato menor vira venda; sem preco unitario, pelo saldo", () => {
    const r = revisarCarga(
      arquivo(acao("PETR4", "20", { preco_unitario: "", saldo_bruto: "800" })),
      { ...vazia, transacoes: [tx({})] },
    );
    expect(r.divergencias[0]?.ajuste).toEqual({
      tipo: "venda",
      quantidade: "10",
      preco: "40.000000",
    });
  });

  it("ticker que sumiu do extrato aparece sem oferecer ajuste", () => {
    const r = revisarCarga(arquivo({ ativo: "X" }), {
      ...vazia,
      transacoes: [
        tx({}),
        tx({ ticker: "VALE3", corretora: "Clear" }),
        tx({ ticker: "ITUB4", corretora: undefined }),
      ],
    });
    expect(r.divergencias).toEqual([
      {
        corretora: "XP",
        ticker: "PETR4",
        sistema: "30",
        extrato: "0",
        ajuste: null,
        data_posicao: "2026-11-05",
      },
    ]);
    expect(
      transacoesDaCarga(r, [{ corretora: "XP", ticker: "PETR4", acao: "gerar_ajuste" }]),
    ).toEqual([]);
  });

  it("extrato zerado sem preco nao oferece ajuste", () => {
    const r = revisarCarga(
      arquivo(acao("PETR4", "0", { preco_unitario: "", saldo_bruto: "0" })),
      { ...vazia, transacoes: [tx({})] },
    );
    expect(r.divergencias[0]?.ajuste).toBeNull();
  });
});

describe("revisarCarga, demais classes", () => {
  const vigente = (ativo: string, corretora = "XP", saldo = "100") => ({
    corretora,
    chave_ativo: `outro|${ativo}`,
    ativo,
    classe: "outro",
    data_posicao: "2026-10-01",
    saldo_bruto: saldo,
    quantidade: null,
    valor_aplicado: null,
  });

  it("separa novas, alteradas e removidas, so nas corretoras do arquivo", () => {
    const r = revisarCarga(
      arquivo(
        { ativo: "IGUAL", saldo_bruto: "100.00" },
        { ativo: "MUDOU", saldo_bruto: "120" },
        { ativo: "NOVO" },
      ),
      {
        ...vazia,
        vigentes: [
          vigente("IGUAL"),
          vigente("MUDOU"),
          vigente("SAIU"),
          vigente("OUTRA", "Clear"),
        ],
      },
    );
    expect(r.novas.map((l) => l.ativo)).toEqual(["NOVO"]);
    expect(r.alteradas).toEqual([
      {
        corretora: "XP",
        ativo: "MUDOU",
        classe: "outro",
        saldo_bruto: "120",
        saldo_anterior: "100",
      },
    ]);
    expect(r.removidas.map((l) => l.ativo)).toEqual(["SAIU"]);
    expect(r.recusas).toEqual([]);
  });

  it("quantidade que passa a existir tambem altera", () => {
    const r = revisarCarga(arquivo({ ativo: "X", quantidade: "2" }), {
      ...vazia,
      vigentes: [vigente("X")],
    });
    expect(r.alteradas).toHaveLength(1);
  });

  it("recusa carga igual ou mais antiga, e so aponta a corretora afetada", () => {
    const base = {
      ...vazia,
      cargas: [{ corretora: "XP", data_posicao: "2026-11-05" }],
    };
    expect(revisarCarga(arquivo({}), base).recusas[0]).toBe(
      "XP: o arquivo é de 05/11/2026 e já existe carga de 05/11/2026. Envie um extrato mais recente.",
    );
    expect(
      revisarCarga(arquivo({ data_posicao: "2026-11-01" }), base).recusas,
    ).toHaveLength(1);
    expect(revisarCarga(arquivo({ data_posicao: "2026-11-06" }), base).recusas).toEqual(
      [],
    );
    expect(revisarCarga(arquivo({ corretora: "Clear" }), base).recusas).toEqual([]);
  });

  it("CargaRecusada junta as mensagens e dataBr nao passa por fuso", () => {
    const e = new CargaRecusada(["a", "b"]);
    expect(e.message).toBe("a b");
    expect(e.recusas).toEqual(["a", "b"]);
    expect(dataBr("2026-01-01")).toBe("01/01/2026");
  });
});

describe("alocacao com posicoes de extrato", () => {
  it("as classes novas entram com rotulo proprio e somam na mesma base", () => {
    const fatias = alocar(
      [
        { ticker: "ITUB4", valor_de_mercado: "100", classe: CLASSE_DE_ALOCACAO.acao },
        { ticker: "CDB", valor_de_mercado: "200", classe: CLASSE_DE_ALOCACAO.renda_fixa },
        {
          ticker: "NTN-B",
          valor_de_mercado: "100",
          classe: CLASSE_DE_ALOCACAO.titulo_publico,
        },
      ] as { ticker: string; valor_de_mercado: string; classe: string }[],
      (p) => (p as unknown as { classe: string }).classe,
    );
    expect(fatias).toEqual([
      { chave: "Renda fixa", valor: "200.00", fracao: 0.5 },
      { chave: "Ações", valor: "100.00", fracao: 0.25 },
      { chave: "Títulos públicos", valor: "100.00", fracao: 0.25 },
    ]);
  });
});
