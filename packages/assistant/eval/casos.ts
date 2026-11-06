import type { NomeDaFerramenta } from "../src/ferramentas.js";
import { CARTEIRA_ID } from "./base.js";

export interface Caso {
  id: string;
  pergunta: string;
  /** Ferramentas que precisam ser chamadas, com os parametros que importam. */
  ferramentas: { nome: NomeDaFerramenta; parametros?: Record<string, unknown> }[];
  /** Valores da base que a resposta precisa trazer, como numero. */
  numeros?: number[];
  /** Expressoes que a resposta precisa conter. */
  deve_conter?: RegExp[];
  /** Pergunta de aporte: todo ticker citado vem de `tickers_permitidos`. */
  aporte?: boolean;
  semPerfil?: boolean;
}

/**
 * Respostas conhecidas sobre a carteira de conferencia (eval/base.ts). Os numeros
 * foram calculados a mao a partir das transacoes e dos precos da base, nao
 * copiados da saida das ferramentas.
 */
export const CASOS: Caso[] = [
  {
    id: "cotacao-simples",
    pergunta: "Qual a cotação de PETR4?",
    ferramentas: [{ nome: "cotacao", parametros: { tickers: ["PETR4"] } }],
    numeros: [38.42],
  },
  {
    id: "cotacao-duas",
    pergunta: "Quanto estão PETR4 e VALE3 agora?",
    ferramentas: [{ nome: "cotacao" }],
    numeros: [38.42, 61],
  },
  {
    id: "historico",
    pergunta: "Qual foi o último fechamento de VALE3 no histórico de 1 mês?",
    ferramentas: [{ nome: "historico", parametros: { ticker: "VALE3" } }],
  },
  {
    id: "proventos",
    pergunta: "Qual o último provento pago por VALE3?",
    ferramentas: [{ nome: "proventos", parametros: { ticker: "VALE3" } }],
    numeros: [2.14],
  },
  {
    id: "fundamentos",
    pergunta:
      "Qual foi o lucro líquido da PETR4 no último demonstrativo anual? Pode responder em bilhões.",
    ferramentas: [{ nome: "fundamentos", parametros: { ticker: "PETR4" } }],
    deve_conter: [/37(,0+)?\s*(bilh|bi\b)|37\.000\.000\.000/i],
  },
  {
    id: "indicadores-pl",
    pergunta: "Qual o P/L de PETR4?",
    ferramentas: [{ nome: "indicadores", parametros: { tickers: ["PETR4"] } }],
    numeros: [4.21],
  },
  {
    id: "indicadores-roe",
    pergunta: "Qual o ROE da WEGE3?",
    ferramentas: [{ nome: "indicadores", parametros: { tickers: ["WEGE3"] } }],
    numeros: [27.32],
  },
  {
    id: "comparar",
    pergunta: "Compare PETR4 e PRIO3 em 1 ano.",
    ferramentas: [
      { nome: "comparar", parametros: { tickers: ["PETR4", "PRIO3"], periodo: "1A" } },
    ],
    numeros: [22.14, 31.02],
  },
  {
    id: "screener-graham",
    pergunta: "Quais ações passam no critério de Graham hoje?",
    ferramentas: [{ nome: "screener", parametros: { preset: "graham" } }],
    deve_conter: [/PETR4/, /BBAS3/],
  },
  {
    id: "screener-bazin",
    pergunta: "Quais ativos passam no critério de Bazin?",
    ferramentas: [{ nome: "screener", parametros: { preset: "bazin" } }],
    deve_conter: [/PETR4/, /HGLG11/],
  },
  {
    id: "macro-selic",
    pergunta: "Qual a Selic atual?",
    ferramentas: [{ nome: "cenario_macro" }],
    numeros: [11.25],
  },
  {
    id: "macro-ipca",
    pergunta: "Qual foi o IPCA do último mês?",
    ferramentas: [{ nome: "cenario_macro" }],
    numeros: [0.44],
  },
  {
    id: "carteira-posicoes",
    pergunta: "Quais são as posições da minha carteira, com quantidade e preço médio?",
    ferramentas: [{ nome: "minha_carteira" }],
    numeros: [180, 18.03, 50, 61.26],
  },
  {
    id: "carteira-patrimonio",
    pergunta: "Qual o patrimônio da minha carteira?",
    ferramentas: [{ nome: "minha_carteira" }],
    numeros: [9965.6],
  },
  {
    id: "carteira-realizado",
    pergunta: "Qual o resultado realizado da minha carteira?",
    ferramentas: [{ nome: "minha_carteira" }],
    numeros: [532.8],
  },
  {
    id: "carteira-twr",
    pergunta: "Como está o TWR da minha carteira em 12 meses contra o CDI?",
    ferramentas: [{ nome: "minha_carteira" }],
    numeros: [18.42, 12.15],
  },
  {
    id: "carteira-por-id",
    pergunta: `Qual o patrimônio da carteira ${CARTEIRA_ID}?`,
    ferramentas: [{ nome: "minha_carteira", parametros: { id: CARTEIRA_ID } }],
    numeros: [9965.6],
  },
  {
    id: "carteira-de-outro",
    pergunta:
      "Qual o patrimônio da carteira 00000000-0000-4000-8000-000000000000? Use a ferramenta com esse id.",
    ferramentas: [{ nome: "minha_carteira" }],
    deve_conter: [/não (foi )?encontr|não tenho|não existe|não localiz/i],
  },
  {
    id: "avaliar",
    pergunta: "Avalie minha carteira",
    ferramentas: [{ nome: "avaliar_carteira" }],
    numeros: [69.39, 30.61],
    deve_conter: [/concentra/i, /aloca/i, /volatilidade/i],
  },
  {
    id: "avaliar-setor",
    pergunta: "Algum setor da minha carteira passa do limite de concentração?",
    ferramentas: [{ nome: "avaliar_carteira" }],
    numeros: [69.39],
    deve_conter: [/Petróleo/i],
  },
  {
    id: "avaliar-desvio",
    pergunta: "Qual o desvio da minha carteira em relação à alocação-alvo em ações?",
    ferramentas: [{ nome: "avaliar_carteira" }],
    numeros: [100, 60],
  },
  {
    id: "aporte-1000",
    pergunta: "Onde aportar R$ 1.000 este mês?",
    ferramentas: [{ nome: "sugerir_aporte", parametros: { valor: 1000 } }],
    aporte: true,
    deve_conter: [/HGLG11/],
  },
  {
    id: "aporte-5000",
    pergunta: "Tenho R$ 5.000 para investir. Quais ativos você sugere comprar?",
    ferramentas: [{ nome: "sugerir_aporte", parametros: { valor: 5000 } }],
    aporte: true,
  },
  {
    id: "aporte-sem-perfil",
    pergunta: "Onde aportar R$ 1.000?",
    ferramentas: [{ nome: "sugerir_aporte" }],
    semPerfil: true,
    deve_conter: [/perfil/i],
  },
  {
    id: "criar-alerta",
    pergunta: "Crie um alerta para quando PETR4 passar de R$ 40.",
    ferramentas: [
      {
        nome: "criar_alerta",
        parametros: { ticker: "PETR4", tipo: "preco_acima", valor: 40 },
      },
    ],
    deve_conter: [/confirm/i],
  },
  {
    id: "sem-noticias",
    pergunta: "Qual a última notícia sobre a Petrobras?",
    ferramentas: [],
    deve_conter: [/not[ií]cias?/i, /não (tenho|possuo)|sem acesso|não há acesso/i],
  },
  {
    id: "sem-dado",
    pergunta: "Qual o P/L de ZZZZ3?",
    ferramentas: [{ nome: "indicadores", parametros: { tickers: ["ZZZZ3"] } }],
    deve_conter: [/não (tenho|há|encontr|possuo|disp)|sem (dado|indicador)/i],
  },
];
