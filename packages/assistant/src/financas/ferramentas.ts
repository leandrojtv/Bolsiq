import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { TIPOS_DE_INSIGHT, somarDias, somarMeses } from "@bolsiq/finance/puro";
import { seguro } from "../ferramentas.js";
import {
  capacidadeDeAporte,
  compararMeses,
  filtrarLancamentos,
  gastosPorCategoria,
  simularCompra,
  sugerirCortes,
} from "./calculos.js";
import type { FontesFinanceiras } from "./tipos.js";

const Mes = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .describe("Mês no formato AAAA-MM, como 2026-10");
const Data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Data no formato AAAA-MM-DD");

export const MAX_LANCAMENTOS = 50;
const MAX_CATEGORIAS = 30;
const MAX_MESES_DO_FLUXO = 24;
const MAX_PARCELAS = 48;
const MAX_DIAS_DO_PERIODO = 366;

export const NOMES_DAS_FERRAMENTAS_FINANCEIRAS = [
  "resumo_mes",
  "gastos_por_categoria",
  "comparar_meses",
  "listar_lancamentos",
  "fluxo_projetado",
  "parcelas_futuras",
  "assinaturas",
  "insights",
  "sugerir_cortes",
  "simular_compra",
  "capacidade_aporte",
] as const;
export type NomeDaFerramentaFinanceira =
  (typeof NOMES_DAS_FERRAMENTAS_FINANCEIRAS)[number];

/** Primeiro e ultimo dia do mes. */
export function intervaloDoMes(mes: string): { de: string; ate: string } {
  const de = `${mes}-01`;
  return { de, ate: somarDias(somarMeses(de, 1), -1) };
}

/** Os `n` meses completos antes do mes de `hoje`, do mais antigo para o mais novo. */
export function mesesAnteriores(hoje: string, n: number): string[] {
  const atual = `${hoje.slice(0, 7)}-01`;
  return Array.from({ length: n }, (_, k) => somarMeses(atual, k - n).slice(0, 7));
}

const SEM_PERIODO = {
  erro: "periodo_invalido",
  mensagem: `Informe um período de até ${MAX_DIAS_DO_PERIODO} dias, com o início antes do fim.`,
};

/** `mes` ganha de `de`/`ate`; sem nada, o padrao. */
function periodo(
  p: { mes?: string | undefined; de?: string | undefined; ate?: string | undefined },
  padrao: { de: string; ate: string },
): { de: string; ate: string } | null {
  if (p.mes) return intervaloDoMes(p.mes);
  const de = p.de ?? padrao.de;
  const ate = p.ate ?? padrao.ate;
  if (de > ate || somarDias(de, MAX_DIAS_DO_PERIODO) < ate) return null;
  return { de, ate };
}

const PeriodoOpcional = {
  mes: Mes.optional(),
  de: Data.optional(),
  ate: Data.optional(),
};

/**
 * Ferramentas do Bolsiq Financas. Todo numero sai de `FontesFinanceiras` e dos
 * calculos de `calculos.ts`: o modelo explica, nao calcula. Saida resumida e
 * com limite de linhas.
 */
export function criarFerramentasFinanceiras(
  fontes: FontesFinanceiras,
  { hoje }: { hoje: string },
): ToolSet {
  const mesAtual = hoje.slice(0, 7);
  const lancamentosDe = (p: { de: string; ate: string }) =>
    fontes.lancamentos(p.de, p.ate);

  return {
    resumo_mes: tool({
      description:
        "Resumo de um mês no Bolsiq Finanças: renda (prevista e recebida), despesas (pagas e a pagar), fixos x variáveis, saldo previsto no fim do mês, parcelas do mês e orçamento. Os mesmos números do dashboard.",
      inputSchema: z.object({ competencia: Mes.optional() }),
      execute: ({ competencia }) =>
        seguro(async () => {
          const mes = competencia ?? mesAtual;
          const r = await fontes.resumoDoMes(mes);
          return {
            ...r.dados,
            link: `/financas?mes=${mes}`,
            proveniencia: r.proveniencia,
          };
        }),
    }),

    gastos_por_categoria: tool({
      description:
        "Gastos (despesas realizadas, sem aportes e sem pagamento de fatura) por categoria num período, do maior para o menor, com % do total. Padrão: mês atual.",
      inputSchema: z.object({
        ...PeriodoOpcional,
        top: z.number().int().min(1).max(MAX_CATEGORIAS).default(10),
      }),
      execute: ({ top, ...p }) =>
        seguro(async () => {
          const intervalo = periodo(p, intervaloDoMes(mesAtual));
          if (!intervalo) return SEM_PERIODO;
          const r = await lancamentosDe(intervalo);
          return {
            periodo: intervalo,
            ...gastosPorCategoria(r.dados, top),
            link: "/financas/lancamentos",
            proveniencia: r.proveniencia,
          };
        }),
    }),

    comparar_meses: tool({
      description:
        "Compara os gastos de dois meses por categoria: valor em cada um e a variação, da maior mudança para a menor.",
      inputSchema: z.object({ a: Mes, b: Mes }),
      execute: ({ a, b }) =>
        seguro(async () => {
          const [la, lb] = await Promise.all([
            lancamentosDe(intervaloDoMes(a)),
            lancamentosDe(intervaloDoMes(b)),
          ]);
          return {
            ...compararMeses(
              { mes: a, lancamentos: la.dados },
              { mes: b, lancamentos: lb.dados },
            ),
            link: "/financas/lancamentos",
            proveniencia: [...la.proveniencia, ...lb.proveniencia].slice(0, 1),
          };
        }),
    }),

    listar_lancamentos: tool({
      description: `Busca lançamentos por texto da descrição (ex.: "ifood"), categoria e tipo num período, com a soma de tudo o que casou. Use para "quanto gastei no X em outubro". Até ${MAX_LANCAMENTOS} linhas; padrão: últimos 90 dias.`,
      inputSchema: z.object({
        ...PeriodoOpcional,
        busca: z.string().trim().min(2).max(60).optional(),
        categoria: z.string().trim().min(2).max(60).optional(),
        tipo: z.enum(["despesa", "receita"]).optional(),
        limite: z.number().int().min(1).max(MAX_LANCAMENTOS).default(20),
      }),
      execute: ({ busca, categoria, tipo, limite, ...p }) =>
        seguro(async () => {
          const intervalo = periodo(p, { de: somarDias(hoje, -90), ate: hoje });
          if (!intervalo) return SEM_PERIODO;
          const r = await lancamentosDe(intervalo);
          return {
            periodo: intervalo,
            ...filtrarLancamentos(r.dados, { busca, categoria, tipo, limite }),
            link: "/financas/lancamentos",
            proveniencia: r.proveniencia,
          };
        }),
    }),

    fluxo_projetado: tool({
      description:
        "Fluxo de caixa projetado das contas: saldo de hoje mais previstos, faturas e recorrências, mês a mês, e o primeiro mês negativo.",
      inputSchema: z.object({
        meses: z.number().int().min(1).max(MAX_MESES_DO_FLUXO).default(6),
      }),
      execute: ({ meses }) =>
        seguro(async () => {
          const r = await fontes.fluxo(meses);
          return { ...r.dados, link: "/financas/fluxo", proveniencia: r.proveniencia };
        }),
    }),

    parcelas_futuras: tool({
      description:
        "Parcelamentos e dívidas ativos (cartão, empréstimo, financiamento): parcelas restantes, valor restante, próxima parcela e o total por mês nos próximos 12 meses.",
      inputSchema: z.object({}),
      execute: () =>
        seguro(async () => {
          const r = await fontes.parcelas();
          return {
            planos: r.dados.planos.slice(0, 20),
            planos_omitidos: Math.max(0, r.dados.planos.length - 20),
            por_mes: r.dados.por_mes,
            link: "/financas/parcelamentos",
            proveniencia: r.proveniencia,
          };
        }),
    }),

    assinaturas: tool({
      description:
        "Assinaturas detectadas nos lançamentos (mesma cobrança todo mês ou todo ano), com reajuste, possível duplicidade, total por mês e por ano.",
      inputSchema: z.object({}),
      execute: () =>
        seguro(async () => {
          const r = await fontes.assinaturas();
          return {
            ...r.dados,
            assinaturas: r.dados.assinaturas.slice(0, 30),
            link: "/financas/assinaturas",
            proveniencia: r.proveniencia,
          };
        }),
    }),

    insights: tool({
      description:
        "Insights do mês calculados pelo Bolsiq: assinaturas, tarifas e juros, efeito formiga, gastos fora do padrão, essencial x supérfluo e ranking, ordenados pelo impacto por ano. Cada um com a ação sugerida.",
      inputSchema: z.object({ tipo: z.enum(TIPOS_DE_INSIGHT).optional() }),
      execute: ({ tipo }) =>
        seguro(async () => {
          const r = await fontes.insights();
          const lista = r.dados.filter((i) => !tipo || i.tipo === tipo);
          return {
            insights: lista.slice(0, 15),
            omitidos: Math.max(0, lista.length - 15),
            link: "/financas/insights",
            proveniencia: r.proveniencia,
          };
        }),
    }),

    sugerir_cortes: tool({
      description:
        'Escolhe, entre os insights, os cortes que somam a economia mensal pedida, mexendo primeiro no que não é essencial. Use para "onde corto R$ X?".',
      inputSchema: z.object({
        meta_mensal: z
          .number()
          .positive()
          .max(1_000_000)
          .describe("Economia por mês, em reais"),
      }),
      execute: ({ meta_mensal }) =>
        seguro(async () => {
          const r = await fontes.insights();
          return {
            ...sugerirCortes(r.dados, meta_mensal.toFixed(2)),
            proveniencia: r.proveniencia,
          };
        }),
    }),

    simular_compra: tool({
      description:
        'Simula uma compra parcelada no fluxo projetado e no orçamento: parcela, saldo mês a mês com e sem a compra e o veredito ("cabe", "apertado" ou "nao_cabe") com os motivos. Use para "posso comprar X em N vezes?".',
      inputSchema: z.object({
        valor: z
          .number()
          .positive()
          .max(10_000_000)
          .describe("Valor total da compra, em reais"),
        parcelas: z.number().int().min(1).max(MAX_PARCELAS).default(1),
      }),
      execute: ({ valor, parcelas }) =>
        seguro(async () => {
          const meses = Math.min(Math.max(parcelas + 1, 6), MAX_MESES_DO_FLUXO + 1);
          const [fluxo, resumo] = await Promise.all([
            fontes.fluxo(meses),
            fontes.resumoDoMes(mesAtual),
          ]);
          return {
            ...simularCompra({
              valor: valor.toFixed(2),
              parcelas,
              fluxo: fluxo.dados,
              resumo: resumo.dados,
            }),
            proveniencia: fluxo.proveniencia,
          };
        }),
    }),

    capacidade_aporte: tool({
      description:
        "Quanto dá para investir por mês: sobra média dos 3 meses completos anteriores, menos o aumento das parcelas que vêm e a parte que completa a reserva de emergência (6 meses de essenciais). O valor serve de entrada para sugerir_aporte.",
      inputSchema: z.object({}),
      execute: () =>
        seguro(async () => {
          const meses = mesesAnteriores(hoje, 3);
          const de = `${meses[0]}-01`;
          const ate = intervaloDoMes(meses.at(-1) as string).ate;
          const [l, p, f] = await Promise.all([
            fontes.lancamentos(de, ate),
            fontes.parcelas(),
            fontes.fluxo(1),
          ]);
          return {
            ...capacidadeDeAporte({
              meses,
              lancamentos: l.dados,
              parcelas_futuras: p.dados.por_mes,
              saldo_em_conta: f.dados.saldo_inicial,
            }),
            link: "/financas/fluxo",
            proveniencia: l.proveniencia,
          };
        }),
    }),
  } satisfies ToolSet & Record<NomeDaFerramentaFinanceira, unknown>;
}
