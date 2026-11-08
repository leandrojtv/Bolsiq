import { describe, expect, it } from "vitest";
import {
  conciliacaoDaSelecao,
  custoNaTela,
  OpcoesDoEnvio,
  PedidoDeConfirmacaoIA,
} from "./importacao-ia-modelo";

const ID = "6f1c2b8e-1d2a-4c3b-9f00-0a1b2c3d4e5f";

describe("conciliacao refeita na tela", () => {
  const linhas = [
    { tipo: "posicao" as const, dados: { corretora: "XP", saldo_bruto: "600" } },
    { tipo: "posicao" as const, dados: { corretora: "XP", saldo_bruto: "400" } },
    { tipo: "transacao" as const, dados: { ticker: "PETR4" } },
  ];
  const totais = [{ descricao: "Patrimônio total", valor: "1000" }];

  it("soma so as posicoes marcadas, por corretora", () => {
    expect(conciliacaoDaSelecao(linhas, totais)).toMatchObject([
      { corretora: "XP", soma: "1000.00", conciliada: true },
    ]);
  });

  it("desmarcar uma linha tira a carga da conciliacao", () => {
    expect(conciliacaoDaSelecao(linhas.slice(1), totais)[0]?.conciliada).toBe(false);
  });
});

describe("pedidos", () => {
  it("confirmacao exige id e tem aceite falso por padrao", () => {
    const p = PedidoDeConfirmacaoIA.parse({
      extracao_id: ID,
      linhas: [{ id: "posicao-1", tipo: "posicao", dados: { ativo: "CDB" } }],
    });
    expect(p).toMatchObject({ aceitar_nao_conciliada: false, decisoes: [] });
    expect(
      PedidoDeConfirmacaoIA.safeParse({ extracao_id: "x", linhas: [] }).success,
    ).toBe(false);
    expect(
      PedidoDeConfirmacaoIA.safeParse({
        extracao_id: ID,
        linhas: [{ id: "1", tipo: "outro", dados: {} }],
      }).success,
    ).toBe(false);
  });

  it("opcoes do multipart tem padrao", () => {
    expect(OpcoesDoEnvio.parse({})).toEqual({
      reprocessar: "false",
      aceitar_imagem: "false",
    });
  });
});

describe("custo na tela", () => {
  it("dolar com casas que importam, ou sem preco", () => {
    expect(custoNaTela("0.002040")).toBe("US$ 0,0020");
    expect(custoNaTela("1.5")).toBe("US$ 1,50");
    expect(custoNaTela(null)).toBe("sem preço conhecido");
  });
});
