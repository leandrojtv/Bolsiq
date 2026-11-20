import type { Caso } from "./casos.js";

/**
 * Perguntas do Bolsiq Financas sobre a base de eval/base-financas.ts (hoje em
 * 30/10/2026). Os numeros foram somados a mao a partir dos lancamentos da base.
 */
export const CASOS_FINANCAS: Caso[] = [
  {
    id: "fin-ifood-outubro",
    modulo: "financas",
    pergunta: "Quanto gastei no iFood em outubro?",
    ferramentas: [
      { nome: "listar_lancamentos", parametros: { busca: "ifood", mes: "2026-10" } },
    ],
    // 45,90 + 62,50 + 38,00
    numeros: [146.4],
  },
  {
    id: "fin-pix-outubro",
    modulo: "financas",
    pergunta: "Quanto mandei de PIX em outubro?",
    ferramentas: [
      { nome: "listar_lancamentos", parametros: { busca: "pix", mes: "2026-10" } },
    ],
    numeros: [300],
  },
  {
    id: "fin-resumo",
    modulo: "financas",
    pergunta: "Como está o meu mês?",
    ferramentas: [{ nome: "resumo_mes" }],
    numeros: [8000, 5161.2],
  },
  {
    id: "fin-onde-mais-gasto",
    modulo: "financas",
    pergunta: "Onde eu mais gasto este mês?",
    ferramentas: [{ nome: "gastos_por_categoria" }],
    // Moradia e Mercado de outubro; o previsto e o aporte nao contam.
    numeros: [2500, 1100],
  },
  {
    id: "fin-comparar",
    modulo: "financas",
    pergunta: "Compare meus gastos de setembro com os de outubro.",
    ferramentas: [{ nome: "comparar_meses", parametros: { a: "2026-09", b: "2026-10" } }],
    // 4.481,20 - 4.208,10; Mercado 1.100 - 880.
    numeros: [273.1, 220],
  },
  {
    id: "fin-compra-cabe",
    modulo: "financas",
    pergunta: "Posso comprar um notebook de R$ 4.000 em 10x?",
    ferramentas: [{ nome: "simular_compra", parametros: { valor: 4000, parcelas: 10 } }],
    numeros: [400],
    deve_conter: [/cabe/i],
  },
  {
    id: "fin-compra-apertada",
    modulo: "financas",
    pergunta: "Posso comprar um carro de R$ 30.000 em 12x?",
    ferramentas: [{ nome: "simular_compra", parametros: { valor: 30000, parcelas: 12 } }],
    // 2.500 por mes leva o orcamento de 5.161,20 a 7.661,20 (planejado 6.000).
    numeros: [2500, 7661.2],
    deve_conter: [/apertad/i],
  },
  {
    id: "fin-cortar-500",
    modulo: "financas",
    pergunta: "Onde corto R$ 500 por mês?",
    ferramentas: [{ nome: "sugerir_cortes", parametros: { meta_mensal: 500 } }],
    // 73,20 (formiga pela metade) + 44,90 + 39,90 + 600 (essencial, so no fim).
    numeros: [758],
    deve_conter: [/essencial/i],
  },
  {
    id: "fin-cortar-100",
    modulo: "financas",
    pergunta: "Quero economizar R$ 100 por mês. O que eu corto?",
    ferramentas: [{ nome: "sugerir_cortes", parametros: { meta_mensal: 100 } }],
    numeros: [118.1],
  },
  {
    id: "fin-fluxo",
    modulo: "financas",
    pergunta: "Como fica meu saldo nos próximos 6 meses?",
    ferramentas: [{ nome: "fluxo_projetado", parametros: { meses: 6 } }],
    numeros: [11820],
  },
  {
    id: "fin-parcelas",
    modulo: "financas",
    pergunta: "Quanto ainda falta pagar de parcelas?",
    ferramentas: [{ nome: "parcelas_futuras" }],
    numeros: [2100],
  },
  {
    id: "fin-assinaturas",
    modulo: "financas",
    pergunta: "Quanto eu gasto com assinaturas por mês?",
    ferramentas: [{ nome: "assinaturas" }],
    numeros: [44.9],
  },
  {
    id: "fin-insights",
    modulo: "financas",
    pergunta: "Onde estou gastando demais?",
    ferramentas: [{ nome: "insights" }],
    numeros: [1756.8],
  },
  {
    id: "fin-capacidade",
    modulo: "financas",
    pergunta: "Quanto posso investir por mês?",
    ferramentas: [{ nome: "capacidade_aporte" }],
    // Sobra 4.024,10 menos 705,00 para a reserva de emergencia.
    numeros: [3319.1],
  },
];
