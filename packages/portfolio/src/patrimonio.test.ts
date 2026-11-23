import { describe, expect, it } from "vitest";
import {
  patrimonioDasCarteiras,
  tickersAbertos,
  type CarteiraParaOPatrimonio,
} from "./patrimonio.js";
import { Transacao } from "./tipos.js";

const compra = (id: string, ticker: string, quantidade: string, preco: string) =>
  Transacao.parse({
    id,
    ticker,
    tipo: "compra",
    data: "2026-01-10",
    quantidade,
    preco,
    taxas: "0",
  });
const venda = (id: string, ticker: string, quantidade: string, preco: string) =>
  Transacao.parse({
    id,
    ticker,
    tipo: "venda",
    data: "2026-03-10",
    quantidade,
    preco,
    taxas: "0",
  });

const carteiras: CarteiraParaOPatrimonio[] = [
  {
    id: "a",
    nome: "Ações",
    transacoes: [
      compra("1", "PETR4", "100", "30"),
      compra("2", "HGLG11", "10", "150"),
      compra("3", "VALE3", "50", "60"),
      venda("4", "VALE3", "50", "70"),
    ],
    posicoes: [],
  },
  {
    id: "b",
    nome: "Renda fixa",
    transacoes: [],
    posicoes: [
      { classe: "renda_fixa", saldo_bruto: "10000.00" },
      { classe: "titulo_publico", saldo_bruto: "5000.50" },
      { classe: "fundo", saldo_bruto: "2000.00" },
      { classe: "previdencia", saldo_bruto: "1000.00" },
    ],
  },
];

describe("patrimonio das carteiras", () => {
  it("ticker pela cotacao (renda variavel); extrato pelo grupo da classe", () => {
    const r = patrimonioDasCarteiras(carteiras, { PETR4: "38.42", HGLG11: "160.00" });
    expect(r).toEqual({
      renda_variavel: "5442.00",
      renda_fixa: "15000.50",
      fundos: "3000.00",
      carteiras: [
        { id: "a", nome: "Ações", valor: "5442.00" },
        { id: "b", nome: "Renda fixa", valor: "18000.50" },
      ],
      sem_cotacao: [],
    });
  });

  it("posicao zerada sai dos tickers; sem cotacao fica fora da soma", () => {
    expect(tickersAbertos(carteiras)).toEqual(["HGLG11", "PETR4"]);
    const r = patrimonioDasCarteiras(carteiras, { PETR4: "38.42" });
    expect(r.sem_cotacao).toEqual(["HGLG11"]);
    expect(r.renda_variavel).toBe("3842.00");
  });

  it("carteira so com ticker e nenhuma cotacao tem valor nulo", () => {
    const r = patrimonioDasCarteiras([carteiras[0] as CarteiraParaOPatrimonio], {});
    expect(r.carteiras[0]?.valor).toBeNull();
    expect(r.renda_variavel).toBe("0.00");
  });
});
