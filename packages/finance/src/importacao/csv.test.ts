import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { d } from "../decimal.js";
import { MapeamentoDeCsv } from "../contratos-importacao.js";
import { conferirFatura } from "../db/importacao.js";
import {
  cabecalhoDoCsv,
  dataDoCsv,
  lerExtrato,
  marcacaoDe,
  PrecisaDeMapeamento,
  proporLinhas,
  valorDoCsv,
} from "./index.js";

const fixture = (nome: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${nome}`, import.meta.url)));
const texto = (s: string) => new TextEncoder().encode(s);

describe("valores e datas de CSV", () => {
  it.each([
    ["1.234,56", "1234.56"],
    ["-50,00", "-50.00"],
    ["R$ -12,30", "-12.30"],
    ["(12,30)", "-12.30"],
    ["12,30 D", "-12.30"],
    ["12,30 C", "12.30"],
    ["12.30", "12.30"],
    ["1,234.56", "1234.56"],
  ])("%s", (v, esperado) => {
    expect(valorDoCsv(v, v === "1,234.56" ? "ponto" : undefined)).toBe(esperado);
  });

  it("recusa o que nao e numero", () => {
    expect(valorDoCsv("")).toBeNull();
    expect(valorDoCsv("abc")).toBeNull();
  });

  it("datas brasileiras, ISO e americana so quando pedida", () => {
    expect(dataDoCsv("05/10/2026")).toBe("2026-10-05");
    expect(dataDoCsv("5/1/26")).toBe("2026-01-05");
    expect(dataDoCsv("2026-10-05")).toBe("2026-10-05");
    expect(dataDoCsv("10/05/2026", "mm/dd/aaaa")).toBe("2026-10-05");
    expect(dataDoCsv("31/02/2026")).toBeNull();
  });
});

describe("marcacao pela descricao", () => {
  it("pagamento e estorno so como credito do cartao", () => {
    expect(marcacaoDe("Pagamento recebido", "cartao", "credito")).toBe("pagamento");
    expect(marcacaoDe("Inclusao de Pagamento", "cartao", "credito")).toBe("pagamento");
    expect(marcacaoDe("Estorno de Loja", "cartao", "credito")).toBe("estorno");
    expect(marcacaoDe("Pagamento de fatura", "conta", "debito")).toBeNull();
    expect(marcacaoDe("Estorno de Loja", "conta", "credito")).toBeNull();
  });

  it("saldo em qualquer destino, IOF so como debito", () => {
    expect(marcacaoDe("SALDO ANTERIOR", "conta", "credito")).toBe("saldo_anterior");
    expect(marcacaoDe("Saldo anterior", "cartao", "debito")).toBe("saldo_anterior");
    expect(marcacaoDe("IOF de compra internacional", "cartao", "debito")).toBe("iof");
    expect(marcacaoDe("IOF AMAZON", "cartao", "debito")).toBe("iof");
    expect(marcacaoDe("Mercado", "cartao", "debito")).toBeNull();
  });
});

describe("Nubank cartao", () => {
  const e = lerExtrato(fixture("nubank-Nubank_2026-11-15.csv"), "Nubank_2026-11-15.csv");
  const linhas = proporLinhas(e);

  it("le cabecalho, sinal e vencimento do nome", () => {
    expect(e).toMatchObject({
      formato: "csv-nubank-cartao",
      tipo: "cartao",
      banco: "Nubank",
      vencimento: "2026-11-15",
    });
    expect(e.linhas).toHaveLength(8);
    expect(linhas.filter((l) => l.sentido === "credito").map((l) => l.marcacao)).toEqual(
      ["pagamento", "estorno"],
    );
  });

  it("IOF marcado e com categoria propria, parcela pela descricao", () => {
    const iof = linhas.find((l) => l.descricao.startsWith("IOF"));
    expect(iof).toMatchObject({ marcacao: "iof", categoria_sugerida: "IOF" });
    expect(linhas.find((l) => l.descricao.includes("Parcela"))).toMatchObject({
      parcela_atual: 2,
      parcela_total: 6,
    });
  });

  it("descricao com virgula entre aspas", () => {
    expect(linhas.at(-1)?.descricao).toBe("Posto Avenida, Combustivel");
  });
});

describe("contas", () => {
  it("Nubank: identificador vira FITID", () => {
    const e = lerExtrato(fixture("nubank-conta.csv"), "NU_conta.csv");
    expect(e).toMatchObject({ formato: "csv-nubank-conta", tipo: "conta" });
    expect(e.linhas[0]).toMatchObject({
      fitid: "6a1f0c2e-0001-4000-8000-000000000001",
      sentido: "credito",
      valor: "5200.00",
    });
    expect(e.linhas[1]).toMatchObject({ sentido: "debito", valor: "89.90" });
  });

  it("Inter: preambulo, windows-1252 e saldo informado", () => {
    const e = lerExtrato(fixture("inter-conta.csv"), "Extrato.csv");
    expect(e).toMatchObject({
      formato: "csv-inter-conta",
      banco: "Inter",
      saldo: { valor: "3210.45", data: "2026-10-15" },
    });
    expect(e.linhas.map((l) => l.descricao)).toContain(
      "Compra no debito SUPERMERCADO CENTRAL",
    );
    expect(e.linhas[2]).toMatchObject({ valor: "1120.00", sentido: "debito" });
  });

  it("Itau: saldo anterior e saldo do dia marcados, sem aviso", () => {
    const e = lerExtrato(fixture("itau-conta.csv"), "extrato-itau.csv");
    const linhas = proporLinhas(e);
    expect(e.avisos).toEqual([]);
    expect(linhas.filter((l) => l.marcacao === "saldo_anterior")).toHaveLength(2);
    expect(linhas.find((l) => l.descricao.startsWith("PAG BOLETO"))).toMatchObject({
      valor: "187.42",
      sentido: "debito",
      marcacao: null,
    });
  });
});

describe("CSV generico com mapeamento salvo", () => {
  const csv = [
    "Dt. Movimento|Histórico|Crédito|Débito|Parc.",
    "05/10/2026|SUPERMERCADO|  |123,45|",
    "06/10/2026|SALARIO|5.000,00||",
    "07/10/2026|LOJA X|  |50,00|2/3",
  ].join("\n");

  it("sem mapeamento, pede as colunas com amostra", () => {
    try {
      lerExtrato(texto(csv), "banco-x.csv");
      throw new Error("deveria pedir mapeamento");
    } catch (e) {
      expect(e).toBeInstanceOf(PrecisaDeMapeamento);
      const p = (e as PrecisaDeMapeamento).csv;
      expect(p.colunas).toEqual(["dt. movimento", "historico", "credito", "debito", "parc."]);
      expect(p.separador).toBe("|");
      expect(p.amostra).toHaveLength(3);
    }
  });

  it("com o mapeamento do cabecalho, le credito e debito separados e a parcela", () => {
    const c = cabecalhoDoCsv(csv)!;
    const m = MapeamentoDeCsv.parse({
      assinatura: c.assinatura,
      tipo: "conta",
      data: "dt. movimento",
      descricao: "historico",
      credito: "credito",
      debito: "debito",
      parcela: "parc.",
    });
    const e = lerExtrato(texto(csv), "banco-x.csv", [m]);
    expect(e.formato).toBe("csv-mapeado");
    expect(e.assinatura).toBe(c.assinatura);
    expect(e.linhas.map((l) => [l.sentido, l.valor])).toEqual([
      ["debito", "123.45"],
      ["credito", "5000.00"],
      ["debito", "50.00"],
    ]);
    expect(e.linhas[2]?.parcela).toEqual({ atual: 2, total: 3 });
  });

  it("coluna unica de valor com sinal invertido (cartao que manda compra negativa)", () => {
    const fatura = "data;descricao;valor\n01/10/2026;CAFE;-10,00\n02/10/2026;PAGAMENTO;99,00";
    const m = MapeamentoDeCsv.parse({
      assinatura: cabecalhoDoCsv(fatura)!.assinatura,
      tipo: "cartao",
      data: "data",
      descricao: "descricao",
      valor: "valor",
      inverter_sinal: true,
    });
    const e = lerExtrato(texto(fatura), "f.csv", [m]);
    expect(e.linhas.map((l) => l.sentido)).toEqual(["debito", "credito"]);
    expect(e.linhas[1]?.marcacao).toBe("pagamento");
  });

  it("mapeamento sem coluna de valor e recusado no contrato", () => {
    expect(
      MapeamentoDeCsv.safeParse({ assinatura: "a", tipo: "conta", data: "d", descricao: "x" })
        .success,
    ).toBe(false);
  });
});

describe("conferencia do total da fatura", () => {
  const linha = (id: string, tipo: string, valor: string, extra = {}) => ({
    id,
    tipo,
    valor,
    marcacao: null as string | null,
    data: "2026-10-01",
    descricao_normalizada: id.toUpperCase(),
    aviso: null as string | null,
    ...extra,
  });

  it("compras e IOF menos estorno; pagamento e saldo anterior fora", () => {
    const c = conferirFatura("162.03", [
      linha("a", "despesa", "100.00"),
      linha("b", "despesa", "60.00"),
      linha("iof", "despesa", "2.03", { marcacao: "iof" }),
      linha("pg", "receita", "900.00", { marcacao: "pagamento" }),
      linha("sa", "despesa", "900.00", { marcacao: "saldo_anterior" }),
      linha("est", "receita", "0.00", { marcacao: "estorno" }),
    ]);
    expect(c).toMatchObject({ confere: true, diferenca: "0.00", suspeitas: [] });
  });

  it("ate R$ 0,05 confere; acima, aponta a linha do valor da diferenca e as repetidas", () => {
    expect(conferirFatura("100.05", [linha("a", "despesa", "100.00")]).confere).toBe(true);
    const c = conferirFatura("100.00", [
      linha("a", "despesa", "100.00"),
      linha("b", "despesa", "35.00"),
      linha("c", "despesa", "12.00", { descricao_normalizada: "CAFE" }),
      linha("d", "despesa", "12.00", { descricao_normalizada: "CAFE" }),
    ]);
    expect(c.confere).toBe(false);
    expect(d(c.diferenca).toFixed(2)).toBe("59.00");
    expect(c.suspeitas).toEqual(["c", "d"]);
    const so = conferirFatura("100.00", [
      linha("a", "despesa", "100.00"),
      linha("b", "despesa", "35.00"),
    ]);
    expect(so.suspeitas).toEqual(["b"]);
  });
});
