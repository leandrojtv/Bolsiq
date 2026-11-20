import { describe, expect, it } from "vitest";
import { numerosDoMes, type LancamentoDoPainel } from "./painel.js";

const l = (x: Partial<LancamentoDoPainel>): LancamentoDoPainel => ({
  tipo: "despesa",
  valor: "10.00",
  status: "realizado",
  category_id: null,
  transferencia_sentido: null,
  ...x,
});
const cats = new Map([
  ["aluguel", { nome: "Moradia", tipo_custo: "fixo" as const }],
  ["mercado", { nome: "Mercado", tipo_custo: "variavel" as const }],
]);

describe("numeros do mes", () => {
  it("pagamento de fatura nao dobra a despesa: so a compra conta", () => {
    const n = numerosDoMes(
      [
        // Compra no cartao.
        l({ valor: "300.00", category_id: "mercado" }),
        // Pagamento da fatura: saida da conta e entrada no cartao.
        l({ tipo: "transferencia", valor: "300.00", transferencia_sentido: "saida" }),
        l({ tipo: "transferencia", valor: "300.00", transferencia_sentido: "entrada" }),
      ],
      cats,
    );
    expect(n.despesas).toEqual({ pagas: "300.00", a_pagar: "0.00", total: "300.00" });
  });

  it("renda prevista x recebida, pagas x a pagar, fixos x variaveis e top 5", () => {
    const n = numerosDoMes(
      [
        l({ tipo: "receita", valor: "5000.00" }),
        l({ tipo: "receita", valor: "1000.00", status: "previsto" }),
        l({ valor: "1500.00", category_id: "aluguel", status: "previsto" }),
        l({ valor: "450.00", category_id: "mercado" }),
        l({ valor: "50.00", status: "conciliado" }),
      ],
      cats,
    );
    expect(n.renda).toEqual({ prevista: "6000.00", recebida: "5000.00" });
    expect(n.despesas).toEqual({ pagas: "500.00", a_pagar: "1500.00", total: "2000.00" });
    expect(n.fixos).toEqual({ valor: "1500.00", percentual_da_renda: 25 });
    expect(n.variaveis).toEqual({ valor: "500.00", percentual_da_renda: 8.3 });
    expect(n.top_categorias.map((c) => [c.nome, c.valor])).toEqual([
      ["Moradia", "1500.00"],
      ["Mercado", "450.00"],
      ["Sem categoria", "50.00"],
    ]);
  });

  it("sem renda, percentual nulo; categoria desconhecida tem nome generico", () => {
    const n = numerosDoMes([l({ category_id: "apagada" })], cats);
    expect(n.fixos.percentual_da_renda).toBeNull();
    expect(n.top_categorias[0]?.nome).toBe("Categoria");
  });
});
