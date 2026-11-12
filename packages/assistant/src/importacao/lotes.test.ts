import { describe, expect, it } from "vitest";
import { estimarTokens, LIMITE_DE_TOKENS } from "../orcamento.js";
import { juntarSaidas } from "./extracao.js";
import { saidaVazia, type PosicaoDaIA, type SaidaDaIA } from "./esquema.js";
import {
  dentroDoLimite,
  montarLotes,
  textoDoLote,
  tokensDaChamada,
  tokensPorLote,
} from "./lotes.js";

describe("divisao em partes", () => {
  it("junta paginas pequenas num lote so", () => {
    const lotes = montarLotes([
      { origem: "página 1", texto: "a" },
      { origem: "página 2", texto: "b" },
    ]);
    expect(lotes).toHaveLength(1);
    expect(textoDoLote(lotes[0]!)).toContain('<documento origem="página 2">');
  });

  it("aba grande vira varios lotes, cada um com o cabecalho da tabela", () => {
    const linhas = Array.from({ length: 4000 }, (_, i) => `ATIVO${i};${i};${i * 10},00`);
    const texto = ["[separador ;]", "Ativo;Quantidade;Saldo", ...linhas].join("\n");
    const lotes = montarLotes([{ origem: "aba Ações", texto }], 5_000);
    expect(lotes.length).toBeGreaterThan(5);
    for (const l of lotes) {
      expect(
        l.partes[0]?.texto.startsWith("[separador ;]\nAtivo;Quantidade;Saldo\n"),
      ).toBe(true);
      expect(estimarTokens(l.partes[0]!.texto)).toBeLessThanOrEqual(5_000);
    }
    const todas = lotes.flatMap((l) => l.partes[0]!.texto.split("\n").slice(2));
    expect(todas).toEqual(linhas);
  });

  it("toda chamada fica abaixo de 100 mil tokens, prompt e saida inclusos", () => {
    const texto = "x".repeat(500_000);
    for (const maxSaida of [8_000, 16_000]) {
      const lotes = montarLotes(
        texto.match(/.{1,1000}/g)!.map((t, i) => ({ origem: `página ${i}`, texto: t })),
        tokensPorLote(maxSaida),
      );
      for (const l of lotes) {
        expect(dentroDoLimite(l, maxSaida)).toBe(true);
        expect(tokensDaChamada(l) + maxSaida).toBeLessThan(LIMITE_DE_TOKENS);
      }
    }
  });
});

const p = (
  origem: string,
  trecho: string,
  campos: Partial<PosicaoDaIA>,
): PosicaoDaIA => ({
  data_posicao: "2026-10-31",
  corretora: "XP",
  classe: "acao",
  subclasse: "",
  ativo: "PETR4",
  codigo: "PETR4",
  cnpj: "",
  emissor: "",
  indexador: "",
  pct_indexador: "",
  taxa_aa: "",
  data_aplicacao: "",
  vencimento: "",
  liquidez_diaria: "",
  quantidade: "100",
  preco_unitario: "",
  preco_medio: "",
  valor_aplicado: "",
  saldo_bruto: "3842",
  ir: "",
  iof: "",
  saldo_liquido: "",
  valorizacao: "cotacao_b3",
  observacao: "",
  ...campos,
  origem: { pagina_ou_aba: origem, trecho_original: trecho },
  confianca: "alta",
});

describe("juntar as partes", () => {
  it("tira a repetida pela origem e pelo ativo com os mesmos valores", () => {
    const a: SaidaDaIA = {
      ...saidaVazia(),
      documento: {
        tipo: "posicao",
        corretora: "XP",
        data_referencia: "2026-10-30",
        totais_declarados: [{ descricao: "Total", valor: "100" }],
      },
      posicoes: [
        p("página 1", "PETR4 100 3842", {}),
        p("página 1", "PETR4  100 3842", { saldo_bruto: "1" }),
      ],
      notas: [
        {
          numero: "1",
          data_pregao: "",
          corretora: "",
          taxas_total: "",
          irrf: "",
          valor_liquido: "",
          sentido_liquido: "",
          origem: { pagina_ou_aba: "p", trecho_original: "t" },
        },
      ],
      avisos: ["x"],
    };
    const b: SaidaDaIA = {
      ...saidaVazia(),
      documento: {
        tipo: "proventos",
        corretora: "",
        data_referencia: "2026-10-31",
        totais_declarados: [{ descricao: "total", valor: "100" }],
      },
      posicoes: [
        p("página 2", "resumo PETR4 100 3842", {}),
        p("página 2", "VALE3 50 2945", { codigo: "VALE3", saldo_bruto: "2945" }),
      ],
      notas: a.notas,
      avisos: ["x", "y"],
    };
    const r = juntarSaidas([a, b]);
    expect(r.posicoes.map((x) => x.codigo)).toEqual(["PETR4", "VALE3"]);
    expect(r.documento).toEqual({
      tipo: "misto",
      corretora: "XP",
      data_referencia: "2026-10-31",
      totais_declarados: [{ descricao: "Total", valor: "100" }],
    });
    expect(r.notas).toHaveLength(1);
    expect(r.avisos).toEqual(["x", "y"]);
  });

  it("um tipo so continua o mesmo tipo", () => {
    const s = {
      ...saidaVazia(),
      documento: { ...saidaVazia().documento, tipo: "posicao" as const },
    };
    expect(juntarSaidas([s, s]).documento.tipo).toBe("posicao");
  });
});
