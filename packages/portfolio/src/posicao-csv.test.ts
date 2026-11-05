import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chaveDoAtivo,
  COLUNAS_POSICAO,
  importarPosicaoBolsiq,
  normalizarTexto,
  pendenciasDaLinha,
} from "./posicao-csv.js";
import type { LinhaDePosicao } from "./tipos.js";

const fixture = readFileSync(
  resolve(import.meta.dirname, "fixtures/posicao-exemplo.csv"),
  "utf8",
);
const cabecalho = COLUNAS_POSICAO.join(",");

/** Linha do layout a partir de um objeto parcial, para o teste dizer so o que importa. */
function linha(campos: Partial<Record<(typeof COLUNAS_POSICAO)[number], string>>) {
  const base = {
    data_posicao: "2026-11-05",
    corretora: "XP",
    classe: "outro",
    ativo: "ATIVO",
    saldo_bruto: "100.00",
    valorizacao: "manual",
    ...campos,
  } as Record<string, string>;
  return COLUNAS_POSICAO.map((c) => base[c] ?? "").join(",");
}
const ler = (...linhas: string[]) =>
  importarPosicaoBolsiq([cabecalho, ...linhas].join("\n"));

describe("importarPosicaoBolsiq com a fixture", () => {
  const r = importarPosicaoBolsiq(fixture);

  it("aceita as cinco linhas validas e rejeita as quatro ruins, com a linha certa", () => {
    expect(r.linhas_lidas).toBe(9);
    expect(r.posicoes.map((p) => p.ativo)).toEqual([
      "CDB NUBANK",
      "NTN-B - AGO/2030",
      "ITUB4",
      "Jive BossaNova 90 FIDC",
      "COE SANTANDER - Retorno Mínimo (Ouro) - ST0524GC0QK",
    ]);
    expect(r.rejeicoes.map((x) => x.linha)).toEqual([7, 8, 9, 10]);
    expect(r.rejeicoes[0]?.motivo).toMatch(/^classe: deve ser uma de/);
    expect(r.rejeicoes[1]?.motivo).toBe("quantidade: obrigatoria em acao");
    expect(r.rejeicoes[2]?.motivo).toBe("saldo_bruto: obrigatorio");
    expect(r.rejeicoes[3]?.motivo).toMatch(/^data_posicao/);
  });

  it("soma o saldo bruto por corretora so nas linhas aceitas", () => {
    expect(r.totais_por_corretora).toEqual([
      {
        corretora: "Nubank",
        data_posicao: "2026-11-05",
        saldo_bruto: "10356.20",
        linhas: 1,
      },
      {
        corretora: "Santander",
        data_posicao: "2026-11-05",
        saldo_bruto: "13227.79",
        linhas: 1,
      },
      { corretora: "XP", data_posicao: "2026-11-05", saldo_bruto: "38929.60", linhas: 3 },
    ]);
  });

  it("lista pendencias sem rejeitar a linha", () => {
    expect(r.pendencias.map((p) => [p.linha, p.motivo])).toEqual([
      [5, "sem CNPJ"],
      [5, "informar CNPJ e quantidade de cotas"],
      [6, "data de aplicação ausente"],
    ]);
  });

  it("campo vazio fica nulo, nao zero", () => {
    const fundo = r.posicoes.find((p) => p.classe === "fundo");
    expect(fundo?.quantidade).toBeNull();
    expect(fundo?.ir).toBeNull();
    expect(fundo?.liquidez_diaria).toBeNull();
    const cdb = r.posicoes.find((p) => p.classe === "renda_fixa");
    expect(cdb?.liquidez_diaria).toBe(false);
    expect(cdb?.pct_indexador).toBe("1.20");
  });
});

describe("importarPosicaoBolsiq, formato", () => {
  it("aceita ponto e virgula, datas DD/MM/AAAA, numero pt-BR e BOM", () => {
    const r = importarPosicaoBolsiq(
      "\uFEFF" +
        [
          COLUNAS_POSICAO.join(";"),
          linha({
            data_posicao: "05/11/2026",
            vencimento: "01/02/2030",
            saldo_bruto: "1.234,56",
            liquidez_diaria: "s",
          })
            .replaceAll(",", ";")
            .replace("1.234;56", "1.234,56"),
        ].join("\r\n"),
    );
    expect(r.rejeicoes).toEqual([]);
    expect(r.posicoes[0]).toMatchObject({
      data_posicao: "2026-11-05",
      vencimento: "2030-02-01",
      saldo_bruto: "1234.56",
      liquidez_diaria: true,
    });
  });

  it("campo entre aspas pode ter o separador e aspa escapada", () => {
    const r = ler(linha({ ativo: '"COE, Ouro ""plus"""' }));
    expect(r.rejeicoes).toEqual([]);
    expect(r.posicoes[0]?.ativo).toBe('COE, Ouro "plus"');
  });

  it("cabecalho errado rejeita o arquivo inteiro", () => {
    const faltando = importarPosicaoBolsiq("data_posicao,classe\n2026-11-05,fundo");
    expect(faltando.posicoes).toEqual([]);
    expect(faltando.rejeicoes[0]?.linha).toBe(1);
    expect(faltando.rejeicoes[0]?.motivo).toMatch(/^cabecalho sem as colunas: corretora/);

    const ordem = [...COLUNAS_POSICAO].reverse().join(",");
    expect(importarPosicaoBolsiq(ordem).rejeicoes[0]?.motivo).toMatch(/nesta ordem/);
  });

  it("arquivo vazio nao e erro", () => {
    expect(importarPosicaoBolsiq("").linhas_lidas).toBe(0);
  });

  it("numero da linha conta as linhas em branco do arquivo", () => {
    const r = ler("", linha({ classe: "imovel" }));
    expect(r.rejeicoes[0]?.linha).toBe(3);
  });

  it.each([
    ["coluna a menos", "2026-11-05,XP", /esperava 24 colunas, veio 2/],
    ["indexador fora", linha({ indexador: "TR" }), /^indexador: deve ser um de/],
    [
      "valorizacao fora",
      linha({ valorizacao: "chute" }),
      /^valorizacao: deve ser uma de/,
    ],
    [
      "liquidez fora",
      linha({ liquidez_diaria: "T" }),
      /^liquidez_diaria: deve ser S ou N/,
    ],
    ["sem corretora", linha({ corretora: "" }), /^corretora: obrigatorio/],
    ["sem data", linha({ data_posicao: "" }), /^data_posicao: obrigatorio/],
    ["sem ativo e sem codigo", linha({ ativo: "" }), /^ativo: obrigatorio/],
    ["cnpj curto", linha({ classe: "fundo", cnpj: "123" }), /^cnpj: deve ter 14/],
    ["taxa em porcentagem", linha({ taxa_aa: "14.69" }), /^taxa_aa: deve vir em fracao/],
    ["pct em porcentagem", linha({ pct_indexador: "120" }), /^pct_indexador: deve vir/],
    ["titulo sem codigo", linha({ classe: "titulo_publico" }), /^codigo: obrigatorio/],
    [
      "acao sem codigo",
      linha({ classe: "acao", quantidade: "1" }),
      /^codigo: obrigatorio/,
    ],
    [
      "ticker invalido",
      linha({ classe: "fii", codigo: "AB-1", quantidade: "1" }),
      /^codigo: ticker/,
    ],
    ["saldo em texto", linha({ saldo_bruto: "muito" }), /^saldo_bruto: valor/],
  ])("rejeita %s", (_nome, bruta, motivo) => {
    const r = ler(bruta);
    expect(r.posicoes).toEqual([]);
    expect(r.rejeicoes[0]?.motivo).toMatch(motivo);
    expect(r.rejeicoes[0]?.conteudo).toBe(bruta);
  });

  it("linha de data antiga da mesma corretora e rejeitada, de outra corretora nao", () => {
    const r = ler(
      linha({ ativo: "A", data_posicao: "2026-11-01" }),
      linha({ ativo: "B" }),
      linha({ ativo: "C", corretora: "Clear", data_posicao: "2026-11-01" }),
    );
    expect(r.posicoes.map((p) => p.ativo)).toEqual(["B", "C"]);
    expect(r.rejeicoes.map((x) => x.linha)).toEqual([2]);
    expect(r.rejeicoes[0]?.motivo).toMatch(/mais recente de XP/);
  });

  it("ativo repetido na corretora e rejeitado: violaria o indice unico", () => {
    const r = ler(
      linha({ ativo: "Fundo  X" }),
      linha({ ativo: "fundo x" }),
      linha({ ativo: "fundo x", corretora: "Clear" }),
    );
    expect(r.posicoes).toHaveLength(2);
    expect(r.rejeicoes.map((x) => x.linha)).toEqual([3]);
    expect(r.rejeicoes[0]?.motivo).toMatch(/repetido em XP/);
  });

  it("normaliza cnpj e maiusculas de codigo, classe e indexador", () => {
    const r = ler(
      linha({
        classe: "FUNDO",
        cnpj: "12.345.678/0001-90",
        indexador: "cdi",
        codigo: "abc",
        valorizacao: "COTA_CVM",
      }),
    );
    expect(r.posicoes[0]).toMatchObject({
      classe: "fundo",
      cnpj: "12345678000190",
      indexador: "CDI",
      codigo: "ABC",
      valorizacao: "cota_cvm",
    });
  });
});

describe("chaveDoAtivo", () => {
  const base = {
    classe: "outro",
    ativo: "Ativo",
    codigo: null,
    cnpj: null,
    emissor: null,
    indexador: null,
    pct_indexador: null,
    taxa_aa: null,
    vencimento: null,
    data_aplicacao: null,
  } as const;

  it("com codigo, classe e codigo", () => {
    for (const classe of ["acao", "fii", "bdr", "etf", "titulo_publico", "coe"] as const)
      expect(chaveDoAtivo({ ...base, classe, codigo: "ABCD11" })).toBe(
        `${classe}|ABCD11`,
      );
  });

  it("coe sem codigo cai no nome; classe fora da lista ignora o codigo", () => {
    expect(chaveDoAtivo({ ...base, classe: "coe" })).toBe("coe|ATIVO");
    expect(chaveDoAtivo({ ...base, classe: "estruturado", codigo: "X1" })).toBe(
      "estruturado|ATIVO",
    );
  });

  it("fundo e previdencia pelo cnpj, sem ele pelo nome normalizado", () => {
    expect(chaveDoAtivo({ ...base, classe: "fundo", cnpj: "12345678000190" })).toBe(
      "12345678000190",
    );
    expect(
      chaveDoAtivo({ ...base, classe: "previdencia", ativo: " Previdência  Ação " }),
    ).toBe("previdencia|PREVIDENCIA ACAO");
  });

  it("renda fixa nao muda com a grafia do numero nem com o acento do emissor", () => {
    const a = chaveDoAtivo({
      ...base,
      classe: "renda_fixa",
      emissor: "Itaú",
      indexador: "CDI",
      pct_indexador: "1.20",
      vencimento: "2027-02-11",
      data_aplicacao: "2026-08-11",
    });
    const b = chaveDoAtivo({
      ...base,
      classe: "renda_fixa",
      emissor: "ITAU",
      indexador: "CDI",
      pct_indexador: "1.2",
      vencimento: "2027-02-11",
      data_aplicacao: "2026-08-11",
    });
    expect(a).toBe(b);
    expect(a).toBe("renda_fixa|ITAU|CDI||1.2|2027-02-11|2026-08-11");
  });

  it("renda fixa sem emissor usa o nome", () => {
    expect(chaveDoAtivo({ ...base, classe: "renda_fixa", ativo: "cdb x" })).toBe(
      "renda_fixa|CDB X|||||",
    );
  });

  it("demais classes, classe e nome normalizado", () => {
    expect(chaveDoAtivo({ ...base, classe: "cripto", ativo: "bítcoin" })).toBe(
      "cripto|BITCOIN",
    );
    expect(normalizarTexto("  São   Paulo ")).toBe("SAO PAULO");
  });
});

describe("pendenciasDaLinha", () => {
  const base: Pick<
    LinhaDePosicao,
    | "classe"
    | "cnpj"
    | "taxa_aa"
    | "pct_indexador"
    | "data_aplicacao"
    | "preco_medio"
    | "observacao"
  > = {
    classe: "outro",
    cnpj: null,
    taxa_aa: null,
    pct_indexador: null,
    data_aplicacao: null,
    preco_medio: null,
    observacao: null,
  };

  it("renda fixa sem taxa nem percentual e sem data", () => {
    expect(pendenciasDaLinha({ ...base, classe: "renda_fixa" })).toEqual([
      "sem taxa",
      "sem data de aplicação",
    ]);
  });

  it("percentual do indexador tambem e taxa em renda fixa", () => {
    expect(
      pendenciasDaLinha({
        ...base,
        classe: "renda_fixa",
        pct_indexador: "1.2",
        data_aplicacao: "2026-01-01",
      }),
    ).toEqual([]);
  });

  it("previdencia sem cnpj, titulo sem taxa, acao sem preco medio, observacao", () => {
    expect(pendenciasDaLinha({ ...base, classe: "previdencia" })).toEqual(["sem CNPJ"]);
    expect(pendenciasDaLinha({ ...base, classe: "titulo_publico" })).toEqual([
      "sem taxa",
    ]);
    expect(pendenciasDaLinha({ ...base, classe: "acao" })).toEqual(["sem preço médio"]);
    expect(pendenciasDaLinha({ ...base, observacao: "ver" })).toEqual(["ver"]);
  });
});
