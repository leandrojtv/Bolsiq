import { describe, expect, it } from "vitest";
import { COLUNAS_DO_BLOCO } from "./esquema.js";
import {
  escreverBlocos,
  extrairBlocos,
  lerResposta,
  tipoPeloCabecalho,
} from "./saida-csv.js";

const CAB_T = COLUNAS_DO_BLOCO.transacoes.join(";");
const CAB_P = COLUNAS_DO_BLOCO.posicoes.join(";");
const linhaT = (x: Record<string, string> = {}) =>
  COLUNAS_DO_BLOCO.transacoes
    .map(
      (c) =>
        (
          ({
            data: "03/10/2026",
            ticker: "PETR4",
            tipo: "compra",
            quantidade: "100",
            preco: "37,85",
            taxas: "0",
            corretora: "XP",
            pagina_ou_aba: "texto",
            trecho_original: "03/10/2026 PETR4 100 37,85",
            confianca: "alta",
            ...x,
          }) as Record<string, string>
        )[c] ?? "",
    )
    .join(";");

describe("blocos da resposta", () => {
  it("le blocos validos e ignora o texto fora deles", () => {
    const r = lerResposta(
      `Aqui estão as linhas:\n\`\`\`csv transacoes\n${CAB_T}\n${linhaT()}\n\`\`\`\nEspero ter ajudado.`,
    );
    expect(r.blocos).toBe(1);
    expect(r.cabecalhos_invalidos).toEqual([]);
    expect(r.saida.transacoes[0]).toMatchObject({
      data: "2026-10-03",
      ticker: "PETR4",
      preco: "37,85",
      origem: { pagina_ou_aba: "texto", trecho_original: "03/10/2026 PETR4 100 37,85" },
      confianca: "alta",
    });
  });

  it("sem bloco nenhum, nada a ler", () => {
    const r = lerResposta("Não encontrei dados financeiros neste trecho.");
    expect(r).toMatchObject({ blocos: 0, cabecalhos_invalidos: [] });
    expect(r.saida.posicoes).toEqual([]);
  });

  it("cerca sem o tipo: deduz pelo cabecalho; cerca de outra linguagem e ignorada", () => {
    const blocos = extrairBlocos(
      `\`\`\`csv\n${CAB_P}\n\`\`\`\n\`\`\`\n${CAB_T}\n\`\`\`\n\`\`\`json\n{"a":1}\n\`\`\``,
    );
    expect(blocos.map((b) => b.tipo)).toEqual(["posicoes", "transacoes"]);
    expect(tipoPeloCabecalho("numero;valor_liquido")).toBe("notas");
    expect(tipoPeloCabecalho("data_pagamento;ticker")).toBe("proventos");
    expect(tipoPeloCabecalho("a;b")).toBeNull();
  });

  it("aceita virgula como separador e colunas em outra ordem", () => {
    const cab = [
      "trecho_original",
      ...COLUNAS_DO_BLOCO.transacoes.filter((c) => c !== "trecho_original"),
    ];
    const linha = cab
      .map((c) =>
        c === "trecho_original" ? '"PETR4, 100, 37.85"' : c === "ticker" ? "VALE3" : "",
      )
      .join(",");
    const r = lerResposta(`\`\`\`csv transacoes\n${cab.join(",")}\n${linha}\n\`\`\``);
    expect(r.saida.transacoes[0]?.ticker).toBe("VALE3");
    expect(r.saida.transacoes[0]?.origem.trecho_original).toBe("PETR4, 100, 37.85");
  });

  it("aspas internas duplicadas e ponto e virgula dentro do campo", () => {
    const r = lerResposta(
      `\`\`\`csv transacoes\n${CAB_T}\n${linhaT({ trecho_original: '"PETR4; ""PN""; 100"' })}\n\`\`\``,
    );
    expect(r.saida.transacoes[0]?.origem.trecho_original).toBe('PETR4; "PN"; 100');
  });

  it("linha com colunas a menos vira rejeicao; as outras seguem", () => {
    const r = lerResposta(
      `\`\`\`csv transacoes\n${CAB_T}\n${linhaT()}\nPETR4;compra;100\n\`\`\``,
    );
    expect(r.saida.transacoes).toHaveLength(1);
    expect(r.saida.malformadas).toEqual([
      {
        tipo: "transacoes",
        motivo: `esperava 12 colunas, veio 3`,
        conteudo: "PETR4;compra;100",
      },
    ]);
  });

  it("cabecalho sem coluna obrigatoria invalida o bloco; sem tipo e sem cabecalho conhecido tambem", () => {
    const r = lerResposta(
      "```csv transacoes\nticker;preco\nPETR4;1\n```\n```csv\na;b\n1;2\n```",
    );
    expect(r.cabecalhos_invalidos.map((x) => x.tipo)).toEqual(["transacoes", "?"]);
    expect(r.cabecalhos_invalidos[0]?.motivo).toMatch(
      /^cabeçalho sem as colunas: data, tipo/,
    );
  });

  it("confianca desconhecida e baixa; acento vale", () => {
    const r = lerResposta(
      `\`\`\`csv transacoes\n${CAB_T}\n${linhaT({ confianca: "média" })}\n${linhaT({ confianca: "talvez", quantidade: "1" })}\n\`\`\``,
    );
    expect(r.saida.transacoes.map((t) => t.confianca)).toEqual(["media", "baixa"]);
  });

  it("bloco cortado no fim (sem a cerca de fechamento) ainda le as linhas inteiras", () => {
    const r = lerResposta(`\`\`\`csv transacoes\n${CAB_T}\n${linhaT()}\n`);
    expect(r.saida.transacoes).toHaveLength(1);
  });

  it("escrever e ler de volta da o mesmo", () => {
    const lida = lerResposta(
      `\`\`\`csv transacoes\n${CAB_T}\n${linhaT({ ativo_no_documento: '"PETROBRAS ""PN""; N2"' })}\n\`\`\``,
    ).saida;
    expect(lida.transacoes[0]?.ativo_no_documento).toBe('PETROBRAS "PN"; N2');
    expect(lerResposta(escreverBlocos(lida)).saida).toEqual(lida);
  });
});
