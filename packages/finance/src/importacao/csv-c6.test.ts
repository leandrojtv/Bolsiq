import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { d } from "../decimal.js";
import {
  categoriaDoC6,
  dataC6,
  lerExtrato,
  pareceTransferencia,
  proporLinhas,
  valorC6,
} from "./index.js";

const NOME = "c6-Fatura_2026-11-10.csv";
const bytes = new Uint8Array(
  readFileSync(new URL(`./fixtures/${NOME}`, import.meta.url)),
);
const CABECALHO =
  "Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)";
const csv = (...linhas: string[]) =>
  new TextEncoder().encode([CABECALHO, ...linhas].join("\r\n"));

describe("leitor CSV do C6: fatura de exemplo", () => {
  const e = lerExtrato(bytes, NOME);
  const linhas = proporLinhas(e);
  const achar = (descricao: string) => linhas.filter((l) => l.descricao === descricao);

  it("reconhece pelo cabecalho e le todas as linhas", () => {
    expect(e).toMatchObject({
      formato: "csv-c6",
      tipo: "cartao",
      banco: "C6",
      conta: "1111,2222,3333",
      saldo: null,
      vencimento: "2026-11-10",
    });
    expect(e.linhas).toHaveLength(42);
    expect(e.avisos).toEqual([
      "3 finais de cartão nesta fatura (1111, 2222, 3333): tudo entra no cartão escolhido",
    ]);
  });

  it("totais batem com o arquivo", () => {
    const soma = (sentido: string) =>
      e.linhas
        .filter((l) => l.sentido === sentido)
        .reduce((s, l) => s.plus(l.valor), d(0))
        .toFixed(2);
    expect(soma("debito")).toBe("5038.20");
    expect(soma("credito")).toBe("6661.61");
  });

  it("pagamento entre aspas vira credito que parece transferencia", () => {
    const [p] = linhas.filter((l) => l.sentido === "credito");
    expect(p).toMatchObject({
      descricao: "Inclusao de Pagamento",
      descricao_normalizada: "INCLUSAO DE PAGAMENTO",
      valor: "6661.61",
      tipo: "receita",
      data: "2026-10-11",
      categoria_sugerida: null,
    });
    expect(pareceTransferencia(p!.descricao_normalizada)).toBe(true);
  });

  it("parcela n/N vem da coluna e a data vai para o mes da parcela", () => {
    expect(achar("CLINICA SORRISO")[0]).toMatchObject({
      parcela_atual: 6,
      parcela_total: 7,
      data: "2026-10-30",
      categoria_sugerida: "Saúde",
    });
    // 11/02 + 8 meses.
    expect(achar("MERCADOLIVRE*2PRODUTO")[0]).toMatchObject({
      parcela_atual: 9,
      parcela_total: 10,
      data: "2026-10-11",
    });
    expect(achar("Anuidade Diferenciada")[0]).toMatchObject({
      parcela_atual: 5,
      parcela_total: 12,
      // A anuidade ja vem com a data da cobranca: mover passaria da fatura.
      data: "2026-10-28",
      valor: "98.00",
      categoria_sugerida: "Tarifas bancárias",
    });
    // "22 FITNESS" e compra unica: o numero na descricao nao vira parcela.
    expect(achar("22 FITNESS")[0]).toMatchObject({
      parcela_atual: null,
      parcela_total: null,
    });
    expect(linhas.filter((l) => l.parcela_atual)).toHaveLength(22);
  });

  it("IOF da compra internacional e identificado e vai para a categoria IOF", () => {
    const iof = linhas.filter((l) => l.descricao.startsWith("IOF "));
    expect(iof.map((l) => [l.descricao, l.valor, l.categoria_sugerida])).toEqual([
      ["IOF ANTHROPIC* CLAUDE SUB SA", "4.05", "IOF"],
      ["IOF ANTHROPIC SA", "0.73", "IOF"],
    ]);
    expect(achar("ANTHROPIC* CLAUDE SUB SA")[0]).toMatchObject({ valor: "115.69" });
    expect(achar("ANTHROPIC SA")[0]).toMatchObject({ valor: "20.93" });
  });

  it("categoria do banco vira sugestao; rotulo vago e '-' ficam sem", () => {
    expect(achar("LOCALIZA")[0]?.categoria_sugerida).toBe("Viagem");
    expect(achar("TEMPEROS MEL")[0]?.categoria_sugerida).toBe("Mercado");
    expect(achar("DELL")[0]?.categoria_sugerida).toBeNull();
  });

  it("dedupe: duas linhas iguais no mesmo dia tem ordinais diferentes", () => {
    const iguais = linhas.filter(
      (l) => l.data === "2026-10-22" && l.descricao === "MERCADOLIVRE*MERCADOL",
    );
    expect(iguais).toHaveLength(2);
    expect(
      new Set(linhas.map((l) => `${l.data}|${l.valor}|${l.descricao}|${l.ordinal}`)).size,
    ).toBe(42);
  });
});

describe("leitor CSV do C6: casos de borda", () => {
  it("valor com virgula, linha vazia e linha ilegivel", () => {
    const e = lerExtrato(
      csv(
        "01/10/2026;X;1234;-;PADARIA;Única;0;0;1.234,56",
        "",
        "32/10/2026;X;1234;-;ERRADA;Única;0;0;10.00",
        "02/10/2026;X;1234;-;ZERO;Única;0;0;0",
      ),
      "fatura.csv",
    );
    expect(e.linhas.map((l) => [l.descricao, l.valor])).toEqual([["PADARIA", "1234.56"]]);
    expect(e.avisos).toEqual([
      "linha 4 ignorada: data ou valor ilegível",
      "linha 5 ignorada: data ou valor ilegível",
    ]);
    expect(e.vencimento).toBeNull();
    expect(e.conta).toBe("1234");
  });

  it("IOF so pareia com compra em dolar de mesmo nome e data", () => {
    const e = lerExtrato(
      csv(
        "01/10/2026;X;1234;-;LOJA US;Única;10.00;5.00;50.00",
        "01/10/2026;X;1234;-;LOJA US;Única;0;0;1.75",
        "01/10/2026;X;1234;-;LOJA US;Única;0;0;3.00",
        "02/10/2026;X;1234;-;LOJA US;Única;0;0;1.75",
      ),
      "fatura.csv",
    );
    expect(e.linhas.map((l) => l.descricao)).toEqual([
      "LOJA US",
      "IOF LOJA US",
      "LOJA US",
      "LOJA US",
    ]);
  });

  it("estorno negativo e credito sem categoria sugerida", () => {
    const [l] = lerExtrato(
      csv("05/10/2026;X;1234;Vestuário;ESTORNO LOJA;Única;0;0;-80.00"),
      "f.csv",
    ).linhas;
    expect(l).toMatchObject({
      sentido: "credito",
      valor: "80.00",
      categoria_sugerida: null,
    });
  });

  it("parcela ilegivel avisa e trata como a vista", () => {
    const e = lerExtrato(csv("05/10/2026;X;1234;-;LOJA;7/3;0;0;10.00"), "f.csv");
    expect(e.linhas[0]?.parcela).toBeNull();
    expect(e.avisos).toEqual(['linha 2: parcela "7/3" não reconhecida']);
  });

  it("CSV de outro banco nao e lido como C6: pede o mapeamento das colunas", () => {
    expect(() =>
      lerExtrato(
        new TextEncoder().encode("data;descricao;valor\n01/10/2026;X;1"),
        "x.csv",
      ),
    ).toThrow(/CSV desconhecido/);
    expect(() =>
      lerExtrato(new TextEncoder().encode("isto nao e extrato"), "x.pdf"),
    ).toThrow(/Formato não suportado/);
  });

  it("windows-1252 tambem e lido", () => {
    const latin = new Uint8Array(
      [...`${CABECALHO}\r\n01/10/2026;X;1234;Educacional;ESCOLA;Única;0;0;10.00`].map(
        (c) => c.charCodeAt(0),
      ),
    );
    expect(lerExtrato(latin, "f.csv").linhas[0]).toMatchObject({
      categoria_sugerida: "Educação",
      parcela: null,
    });
  });
});

describe("helpers do C6", () => {
  it.each([
    ["30/05/2026", "2026-05-30"],
    ["31/02/2026", null],
    ["2026-05-30", null],
  ])("dataC6(%s)", (t, esperado) => expect(dataC6(t)).toBe(esperado));

  it.each([
    ["155.71", "155.71"],
    ["-6661.61", "-6661.61"],
    ["900", "900.00"],
    ["1.234,5", "1234.50"],
    ["abc", null],
  ])("valorC6(%s)", (t, esperado) => expect(valorC6(t)).toBe(esperado));

  it.each([
    ["Assistência médica e odontológica", "Saúde"],
    ["Supermercados / Mercearia / Padarias / Lojas de Conveniência", "Mercado"],
    ["Departamento / Desconto", "Compras"],
    ["Arte / Artesanato / Passatempo", "Lazer"],
    ["Serviços de telecomunicações", "Contas da casa"],
    ["Relacionados a Automotivo", "Transporte"],
    ["T&E", "Viagem"],
    ["Empresa para empresa", null],
    ["Elétrico", null],
    ["-", null],
  ])("categoriaDoC6(%s)", (c, esperado) => expect(categoriaDoC6(c)).toBe(esperado));
});
