import { describe, expect, it } from "vitest";
import {
  camposDaLinha,
  conciliacaoDaSelecao,
  custoNaTela,
  OpcoesDoEnvio,
  PedidoDeConfirmacaoIA,
  PedidoDeReprocessamento,
  sugerirCorretora,
  textoDoProgresso,
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
      aceitar_imagem: "false",
      corretoras: [],
      senhas: {},
    });
    expect(
      OpcoesDoEnvio.parse({
        corretoras: ["XP", ""],
        senhas: { "a.pdf": "123" },
        modelo: " m ",
      }),
    ).toMatchObject({ corretoras: ["XP", ""], senhas: { "a.pdf": "123" }, modelo: "m" });
  });
});

describe("custo na tela", () => {
  it("dolar com casas que importam, ou sem preco", () => {
    expect(custoNaTela("0.002040")).toBe("US$ 0,0020");
    expect(custoNaTela("1.5")).toBe("US$ 1,50");
    expect(custoNaTela(null)).toBe("sem preço conhecido");
  });
});

describe("tela da importacao v2", () => {
  it("sugere a corretora pelo nome do arquivo", () => {
    expect(sugerirCorretora("XP_Posicao_Detalhada.pdf")).toBe("XP");
    expect(sugerirCorretora("Nubank_Extrato_de_Custodia[03_11_26].pdf")).toBe("Nubank");
    expect(sugerirCorretora("Extrato_COE_Santander.xlsx")).toBe("Santander");
    expect(sugerirCorretora("itau-investimentos.pdf")).toBe("Itaú");
    expect(sugerirCorretora("carteira.csv")).toBe("");
  });

  it("progresso por etapa: lote n de N e linhas, rodada da correcao", () => {
    expect(
      textoDoProgresso({
        estado: "analisando",
        progresso: { etapa: "analisando", feitos: 2, total: 5, linhas: 37 },
      }),
    ).toBe("IA lote 2 de 5, 37 linhas");
    expect(
      textoDoProgresso({
        estado: "corrigindo",
        progresso: { etapa: "corrigindo", feitos: 1, total: 2 },
      }),
    ).toBe("Corrigindo (rodada 1 de 2)");
    expect(textoDoProgresso({ estado: "ocr", progresso: null })).toBe(
      "Lendo páginas escaneadas (OCR)",
    );
    expect(
      textoDoProgresso({ estado: "validando", progresso: { etapa: "validando" } }),
    ).toBe("Conciliando");
  });

  it("campo com problema sempre aparece para editar", () => {
    const campos = camposDaLinha({
      tipo: "posicao",
      problemas: ["cnpj", "saldo_bruto"],
    }).map((c) => c.campo);
    expect(campos).toContain("cnpj");
    expect(campos.filter((c) => c === "saldo_bruto")).toHaveLength(1);
  });

  it("reprocessar pede o indice; lotes e modelo sao opcionais", () => {
    expect(PedidoDeReprocessamento.safeParse({ indice: 0, lotes: [2] }).success).toBe(
      true,
    );
    expect(PedidoDeReprocessamento.safeParse({ lotes: [2] }).success).toBe(false);
  });
});
