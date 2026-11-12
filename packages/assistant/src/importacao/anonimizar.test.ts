import { describe, expect, it } from "vitest";
import { anonimizar, somarRemocoes } from "./anonimizar.js";

describe("anonimizacao", () => {
  it("CPF sai em todos os formatos", () => {
    const { texto, remocoes } = anonimizar(
      "Titular com CPF 123.456.789-09\nmascarado ***.456.789-**\ncru 12345678909 fim",
    );
    expect(texto).not.toMatch(/123\.456|456\.789|12345678909/);
    expect(remocoes.cpf).toBe(3);
  });

  it("CNPJ fica, formatado ou nao, e ticker tambem", () => {
    const entrada = "XP MACRO FIM;12.345.678/0001-90;12345678000190;PETR4;HGLG11";
    expect(anonimizar(entrada).texto).toBe(entrada);
  });

  it("conta, agencia e codigo de cliente saem; o valor da linha fica", () => {
    const { texto } = anonimizar(
      "Agência: 0001 Conta: 9876543-2\nAg. 1234 C/C 01-000123-4\nCódigo cliente | 7654321\nConta:;1234567\nSaldo 1.234,56",
    );
    expect(texto).not.toMatch(/0001 |9876543|1234 |000123|7654321|1234567/);
    expect(texto).toContain("Saldo 1.234,56");
  });

  it("linha de nome, endereco, e-mail e telefone sai, e o nome some do resto", () => {
    const { texto, remocoes } = anonimizar(
      [
        "Nome: MARIA DA SILVA SOUZA",
        "Endereço: Rua das Flores, 100",
        "CEP: 01000-000",
        "Olá, Maria da Silva Souza! Seu saldo:",
        "contato maria@exemplo.com.br ou (11) 98765-4321 ou +55 11 912345678",
        "Cliente | JOSÉ PEREIRA",
        "Nota emitida para José Pereira",
      ].join("\n"),
    );
    expect(texto).not.toMatch(
      /maria|souza|flores|01000|exemplo|98765|912345678|jos[eé]/i,
    );
    expect(texto).toContain("[titular]! Seu saldo:");
    expect(remocoes.linhas).toBeGreaterThanOrEqual(4);
    expect(remocoes.email).toBe(1);
    expect(remocoes.telefone).toBe(2);
  });

  it("saudacao da XP: o nome sai, os totais da linha ficam", () => {
    const { texto, remocoes } = anonimizar(
      "Maria Da Silva, este é o seu patrimônio;Total investido\nR$ 1.000,00;R$ 900,00\nmaria da silva",
    );
    expect(texto).not.toMatch(/maria/i);
    expect(texto).toContain("[titular], este é o seu patrimônio;Total investido");
    expect(texto).toContain("R$ 1.000,00");
    expect(remocoes.linhas).toBe(2);
  });

  it("cabecalho de tabela com 'Nome do ativo' nao e dado pessoal", () => {
    const entrada = "Nome do ativo;Quantidade;Saldo\nPETR4;100;3842";
    expect(anonimizar(entrada).texto).toBe(entrada);
  });

  it("'Cliente: XP' nao vira nome a caçar no texto", () => {
    const { texto } = anonimizar("Cliente: XP\nCorretora XP Investimentos");
    expect(texto).toContain("Corretora XP Investimentos");
  });

  it("soma as remocoes de varias partes", () => {
    const a = anonimizar("CPF: 123.456.789-09").remocoes;
    expect(somarRemocoes(a, a).linhas).toBe(2);
  });
});
