import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { d } from "../decimal.js";
import {
  chaveDeDedupe,
  dataOfx,
  decodificar,
  lerExtrato,
  pareceTransferencia,
  proporLinhas,
  valorOfx,
} from "./index.js";

const fixture = (nome: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${nome}`, import.meta.url)));
const ler = (nome: string) => lerExtrato(fixture(nome), nome);

/** Soma com sinal das linhas: tem de bater com o LEDGERBAL das fixtures de conta. */
const soma = (nome: string) =>
  ler(nome)
    .linhas.reduce(
      (s, l) => (l.sentido === "credito" ? s.plus(l.valor) : s.minus(l.valor)),
      d(0),
    )
    .toFixed(2);

describe("leitor OFX: fixtures por banco", () => {
  it.each([
    ["nubank-conta.ofx", "conta", "0260", "11111111-1", 5, "1302.43"],
    ["itau-conta.ofx", "conta", "0341", "0000000001", 6, "4099.89"],
    ["inter-conta.ofx", "conta", "077", "22222222", 4, "57.26"],
    ["c6-conta.ofx", "conta", "336", "33333333", 4, "892.60"],
    ["bb-conta.ofx", "conta", "001", "44444-4", 4, "2028.40"],
  ])("%s", (nome, tipo, banco, conta, n, saldo) => {
    const e = ler(nome);
    expect(e).toMatchObject({ formato: "ofx", tipo, banco, conta, avisos: [] });
    expect(e.linhas).toHaveLength(n);
    expect(e.inicio).toBe("2023-11-01");
    expect(e.fim).toBe("2023-11-30");
    expect(e.saldo).toEqual({ valor: saldo, data: "2023-11-30" });
    // Saldo inicial zero nas fixtures: as linhas somam o LEDGERBAL.
    expect(soma(nome)).toBe(saldo);
  });

  it.each([
    ["nubank-cartao.ofx", "NU PAGAMENTOS S.A.", "nubank-cartao-anonimo", 6],
    ["itau-cartao.ofx", null, "5555XXXXXXXX1234", 6],
    ["inter-cartao.ofx", "Banco Inter", "************4321", 4],
    ["c6-cartao.ofx", null, "5302 **** **** 8765", 4],
    ["bb-cartao.ofx", "Banco do Brasil", "4984********5678", 4],
  ])("%s", (nome, banco, conta, n) => {
    const e = ler(nome);
    expect(e).toMatchObject({ tipo: "cartao", banco, conta });
    expect(e.linhas).toHaveLength(n);
    expect(e.saldo?.valor.startsWith("-")).toBe(true);
  });

  it("latin1 (Itaú, BB) e UTF-8 (Nubank, Inter) viram o mesmo texto", () => {
    expect(ler("itau-conta.ofx").linhas[0]?.descricao).toBe("SALÁRIO EMPRESA EXEMPLO");
    expect(ler("bb-cartao.ofx").linhas[0]?.descricao).toBe(
      "PADARIA AÇÚCAR & AFETO BELO HORIZONTE MG",
    );
    expect(ler("nubank-conta.ofx").linhas[1]?.descricao).toBe(
      "Compra no débito - Mercado Bom Preço",
    );
    expect(ler("inter-conta.ofx").linhas[1]?.descricao).toBe(
      "Compra no debito Farmácia Saúde & Vida",
    );
  });

  it("NAME + MEMO quando os dois existem; sem repetir quando um contem o outro", () => {
    expect(ler("bb-conta.ofx").linhas[1]?.descricao).toBe(
      "Pagamento de Título CONCESSIONÁRIA DE ENERGIA",
    );
    expect(ler("itau-cartao.ofx").linhas[0]?.descricao).toBe("PAG*PADARIA SAO JOAO");
  });

  it("FITID, TRNTYPE, sentido e valor", () => {
    const [salario, cafe] = ler("itau-conta.ofx").linhas;
    expect(salario).toMatchObject({
      fitid: "20231101001",
      trntype: "CREDIT",
      data: "2023-11-01",
      valor: "7500.00",
      sentido: "credito",
    });
    expect(cafe).toMatchObject({ valor: "8.50", sentido: "debito" });
    expect(ler("c6-cartao.ofx").linhas.every((l) => l.fitid === null)).toBe(true);
    expect(ler("c6-conta.ofx").linhas[0]?.valor).toBe("1200.00");
  });
});

describe("partes do OFX", () => {
  it("datas com e sem fuso, com e sem hora", () => {
    expect(dataOfx("20231105000000[-3:BRT]")).toBe("2023-11-05");
    expect(dataOfx("20231105120000.000[-03:EST]")).toBe("2023-11-05");
    expect(dataOfx("20231105")).toBe("2023-11-05");
    expect(dataOfx("20231105235959")).toBe("2023-11-05");
    expect(dataOfx("20230231")).toBeNull();
    expect(dataOfx("ontem")).toBeNull();
    expect(dataOfx(null)).toBeNull();
  });

  it("valores com ponto, virgula e milhar", () => {
    expect(valorOfx("-45.90")).toEqual({ valor: "45.90", negativo: true });
    expect(valorOfx("-12,50")).toEqual({ valor: "12.50", negativo: true });
    expect(valorOfx("1.200,00")).toEqual({ valor: "1200.00", negativo: false });
    expect(valorOfx("1,200.5")).toEqual({ valor: "1200.50", negativo: false });
    expect(valorOfx("+7")).toEqual({ valor: "7.00", negativo: false });
    expect(valorOfx("abc")).toBeNull();
    expect(valorOfx(null)).toBeNull();
  });

  it("transacao ilegivel vira aviso, nao derruba o arquivo", () => {
    const ofx = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
      <STMTTRN><DTPOSTED>2023<TRNAMT>-1.00</STMTTRN>
      <STMTTRN><DTPOSTED>20231101<TRNAMT>0.00</STMTTRN>
      <STMTTRN><DTPOSTED>20231101<TRNAMT>-2.00</STMTTRN>
    </BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const e = lerExtrato(new TextEncoder().encode(ofx), "x.ofx");
    expect(e.linhas).toEqual([
      expect.objectContaining({ indice: 0, descricao: "(sem descrição)", valor: "2.00" }),
    ]);
    expect(e.avisos).toHaveLength(2);
    expect(e).toMatchObject({ banco: null, conta: null, inicio: null, saldo: null });
  });

  it("entidades XML e numericas", () => {
    const ofx = `<OFX><STMTRS><BANKTRANLIST><STMTTRN><DTPOSTED>20231101</DTPOSTED><TRNAMT>-1</TRNAMT><NAME>A &#65;&#x42; &lt;C&gt; &quot;D&apos; &foo;</NAME></STMTTRN></BANKTRANLIST></STMTRS></OFX>`;
    expect(lerExtrato(new TextEncoder().encode(ofx), "x.ofx").linhas[0]?.descricao).toBe(
      `A AB <C> "D' &foo;`,
    );
  });

  it("recusa o que nao e OFX ou nao tem extrato", () => {
    expect(() => lerExtrato(new TextEncoder().encode("a;b;c"), "x.csv")).toThrow(
      /só OFX/,
    );
    expect(() => lerExtrato(new TextEncoder().encode("OFXHEADER:100"), "x.ofx")).toThrow(
      /<OFX>/,
    );
    expect(() =>
      lerExtrato(new TextEncoder().encode("<OFX><SIGNONMSGSRSV1/></OFX>"), "x.ofx"),
    ).toThrow(/sem extrato/);
  });

  it("decodifica BOM e latin1", () => {
    expect(decodificar(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe("A");
    expect(decodificar(new Uint8Array([0x43, 0x41, 0x46, 0xc9]))).toBe("CAFÉ");
  });
});

describe("linhas propostas", () => {
  it("normaliza, detecta parcela e numera ocorrencias iguais no mesmo dia", () => {
    const linhas = proporLinhas(ler("itau-conta.ofx"));
    expect(linhas.map((l) => l.ordinal)).toEqual([1, 1, 2, 1, 1, 1]);
    expect(linhas[1]).toMatchObject({
      tipo: "despesa",
      descricao_normalizada: "CAFE DA ESQUINA",
    });
    expect(linhas[0]?.tipo).toBe("receita");
    expect(chaveDeDedupe("conta:x", linhas[1]!)).not.toBe(
      chaveDeDedupe("conta:x", linhas[2]!),
    );
    expect(chaveDeDedupe("conta:x", linhas[1]!)).toBe(
      "conta:x|2023-11-03|-8.50|CAFE DA ESQUINA|1",
    );

    const cartao = proporLinhas(ler("itau-cartao.ofx"));
    expect(cartao[2]).toMatchObject({
      descricao_normalizada: "LOJA MAGAZINE EXEMPLO",
      parcela_atual: 3,
      parcela_total: 10,
    });
    expect(cartao[0]?.parcela_atual).toBeNull();
  });

  it("sugere transferencia para pagamento de fatura e transferencia propria", () => {
    const desc = (nome: string, i: number) =>
      proporLinhas(ler(nome))[i]?.descricao_normalizada ?? "";
    expect(pareceTransferencia(desc("nubank-conta.ofx", 3))).toBe(true);
    expect(pareceTransferencia(desc("nubank-cartao.ofx", 3))).toBe(true);
    expect(pareceTransferencia(desc("itau-conta.ofx", 5))).toBe(true);
    expect(pareceTransferencia(desc("itau-cartao.ofx", 4))).toBe(true);
    expect(pareceTransferencia(desc("bb-conta.ofx", 2))).toBe(true);
    expect(pareceTransferencia(desc("bb-cartao.ofx", 3))).toBe(true);
    expect(pareceTransferencia(desc("c6-conta.ofx", 2))).toBe(true);
    expect(pareceTransferencia(desc("c6-conta.ofx", 1))).toBe(false);
  });
});
