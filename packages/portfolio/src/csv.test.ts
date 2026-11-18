import { describe, expect, it } from "vitest";
import {
  importarCsvBolsiq,
  importarExtratoB3,
  normalizarData,
  normalizarNumero,
} from "./csv.js";
import { apurar } from "./posicao.js";

describe("normalizarNumero", () => {
  it("converte pt-BR para string decimal", () => {
    expect(normalizarNumero("1.234,56")).toBe("1234.56");
    expect(normalizarNumero("38,42")).toBe("38.42");
    expect(normalizarNumero("1234.56")).toBe("1234.56");
    expect(normalizarNumero("100")).toBe("100");
  });

  it("a ordem das substituicoes importa", () => {
    // Trocar a virgula antes de remover o ponto daria "1.234.56".
    expect(normalizarNumero("1.234.567,89")).toBe("1234567.89");
  });

  it("vazio vira zero", () => {
    expect(normalizarNumero("")).toBe("0");
    expect(normalizarNumero("   ")).toBe("0");
  });
});

describe("normalizarData", () => {
  it("aceita os dois formatos", () => {
    expect(normalizarData("2024-01-15")).toBe("2024-01-15");
    expect(normalizarData("15/01/2024")).toBe("2024-01-15");
  });
});

describe("importarCsvBolsiq", () => {
  const cabecalho = "data;ticker;tipo;quantidade;preco;taxas;corretora";

  it("importa linhas validas", () => {
    const r = importarCsvBolsiq(
      [
        cabecalho,
        "15/01/2024;PETR4;compra;100;35,00;5,00;XP",
        "10/02/2024;VALE3;compra;80;62,00;4,00;Clear",
      ].join("\n"),
    );
    expect(r.transacoes).toHaveLength(2);
    expect(r.rejeicoes).toHaveLength(0);
    expect(r.transacoes[0]).toMatchObject({
      ticker: "PETR4",
      tipo: "compra",
      data: "2024-01-15",
      quantidade: "100",
      preco: "35.00",
      corretora: "XP",
    });
  });

  it("aceita virgula como separador de coluna", () => {
    const r = importarCsvBolsiq(
      "data,ticker,tipo,quantidade,preco\n2024-01-15,PETR4,compra,100,35.00",
    );
    expect(r.transacoes).toHaveLength(1);
  });

  it("nao para na primeira linha ruim", () => {
    const r = importarCsvBolsiq(
      [
        cabecalho,
        "15/01/2024;PETR4;compra;100;35,00;5,00;XP",
        "99/99/2024;VALE3;compra;80;62,00;0;XP",
        "10/02/2024;petr4;compra;50;38,00;0;XP",
        "10/03/2024;ITUB4;vender;10;30,00;0;XP",
      ].join("\n"),
    );
    // Duas validas: a terceira tem ticker minusculo, normalizado antes do parse.
    expect(r.transacoes).toHaveLength(2);
    expect(r.rejeicoes).toHaveLength(2);
    expect(r.rejeicoes[0]?.linha).toBe(3);
    expect(r.rejeicoes[1]?.motivo).toMatch(/tipo/);
  });

  it("relata a linha e o conteudo rejeitado", () => {
    const r = importarCsvBolsiq([cabecalho, "x;y;z;a;b;c;d"].join("\n"));
    expect(r.rejeicoes[0]).toMatchObject({ linha: 2, conteudo: "x;y;z;a;b;c;d" });
    expect(r.rejeicoes[0]?.motivo.length).toBeGreaterThan(5);
  });

  it("cabecalho sem coluna obrigatoria rejeita o arquivo, nao cada linha", () => {
    const r = importarCsvBolsiq("data;ticker;quantidade\n2024-01-15;PETR4;100");
    expect(r.transacoes).toHaveLength(0);
    expect(r.rejeicoes).toHaveLength(1);
    expect(r.rejeicoes[0]?.motivo).toMatch(/tipo, preco/);
  });

  it("taxas e corretora sao opcionais", () => {
    const r = importarCsvBolsiq(
      "data;ticker;tipo;quantidade;preco\n2024-01-15;PETR4;compra;100;35.00",
    );
    expect(r.transacoes[0]?.taxas).toBe("0");
    expect(r.transacoes[0]?.corretora).toBeUndefined();
  });

  it("arquivo vazio nao e erro", () => {
    expect(importarCsvBolsiq("")).toMatchObject({ linhas_lidas: 0, rejeicoes: [] });
  });

  it("importa 500 linhas em menos de 5 segundos", () => {
    const linhas = [cabecalho];
    for (let i = 0; i < 500; i++) {
      const dia = String((i % 28) + 1).padStart(2, "0");
      const mes = String((i % 12) + 1).padStart(2, "0");
      linhas.push(`${dia}/${mes}/2024;PETR4;compra;10;3${i % 10},50;1,00;XP`);
    }

    const r = importarCsvBolsiq(linhas.join("\n"));

    expect(r.linhas_lidas).toBe(500);
    expect(r.transacoes).toHaveLength(500);
    expect(r.rejeicoes).toHaveLength(0);
    expect(r.duracao_ms).toBeLessThan(5000);

    // E o resultado tem de ser apuravel, nao so parseavel.
    const apurado = apurar(r.transacoes);
    expect(apurado.posicoes[0]?.quantidade).toBe("5000.00000000");
  });

  it("500 linhas com 50 invalidas importam 450 e relatam 50", () => {
    const linhas = [cabecalho];
    for (let i = 0; i < 500; i++) {
      linhas.push(
        i % 10 === 0
          ? `data-ruim;PETR4;compra;10;35,00;0;XP`
          : `15/01/2024;PETR4;compra;10;35,00;0;XP`,
      );
    }
    const r = importarCsvBolsiq(linhas.join("\n"));
    expect(r.transacoes).toHaveLength(450);
    expect(r.rejeicoes).toHaveLength(50);
    expect(r.duracao_ms).toBeLessThan(5000);
  });
});

describe("importarExtratoB3", () => {
  const cab =
    "Data do Negócio;Tipo de Movimentação;Mercado;Prazo/Vencimento;Instituição;Código de Negociação;Quantidade;Preço;Valor";

  it("mapeia Compra e Venda", () => {
    const r = importarExtratoB3(
      [
        cab,
        "15/01/2024;Compra;Mercado à Vista;-;XP;PETR4;100;35,00;3500,00",
        "20/02/2024;Venda;Mercado à Vista;-;XP;VALE3;50;65,00;3250,00",
      ].join("\n"),
    );
    expect(r.transacoes).toHaveLength(2);
    expect(r.transacoes[0]).toMatchObject({ ticker: "PETR4", tipo: "compra" });
    expect(r.transacoes[1]).toMatchObject({ ticker: "VALE3", tipo: "venda" });
  });

  it("tira o F do fracionario", () => {
    const r = importarExtratoB3(
      [cab, "15/01/2024;Compra;à Vista;-;XP;PETR4F;7;35,00;245,00"].join("\n"),
    );
    expect(r.transacoes[0]?.ticker).toBe("PETR4");
  });

  it("rejeita movimentacao desconhecida sem abortar o arquivo", () => {
    const r = importarExtratoB3(
      [
        cab,
        "15/01/2024;Compra;à Vista;-;XP;PETR4;100;35,00;3500,00",
        "16/01/2024;Transferência;à Vista;-;XP;PETR4;10;0,00;0,00",
      ].join("\n"),
    );
    expect(r.transacoes).toHaveLength(1);
    expect(r.rejeicoes).toHaveLength(1);
    expect(r.rejeicoes[0]?.motivo).toMatch(/nao reconhecido/);
  });

  it("recusa arquivo que nao e extrato da B3", () => {
    const r = importarExtratoB3("a;b;c\n1;2;3");
    expect(r.rejeicoes[0]?.motivo).toMatch(/extrato da B3/);
  });

  it("arquivo so com cabecalho nao e erro", () => {
    expect(importarExtratoB3(cab)).toMatchObject({ transacoes: [], rejeicoes: [] });
  });
});

describe("ramos restantes do importador", () => {
  it("corretora em branco nao vira string vazia", () => {
    const r = importarCsvBolsiq(
      "data;ticker;tipo;quantidade;preco;taxas;corretora\n2024-01-15;PETR4;compra;100;35.00;0;",
    );
    expect(r.transacoes[0]?.corretora).toBeUndefined();
  });

  it("campos entre aspas sao aceitos", () => {
    const r = importarCsvBolsiq(
      'data;ticker;tipo;quantidade;preco\n"2024-01-15";"PETR4";"compra";"100";"35.00"',
    );
    expect(r.transacoes).toHaveLength(1);
  });

  it("extrato da B3 com separador virgula", () => {
    const r = importarExtratoB3(
      "Data do Negócio,Tipo de Movimentação,Código de Negociação,Quantidade,Preço\n15/01/2024,Compra,PETR4,100,35.00",
    );
    expect(r.transacoes).toHaveLength(1);
  });
});
