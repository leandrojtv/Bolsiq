"use client";

import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  TooltipComponent,
} from "echarts/components";
import { init, use, type EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  TooltipComponent,
  CanvasRenderer,
]);

const token = (nome: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(`--${nome}`).trim();
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compacto = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const rotuloDoMes = (m: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" })
    .format(new Date(`${m}-01T00:00:00Z`))
    .replace(".", "");

function useGrafico(opcao: () => Record<string, unknown>, deps: unknown[]) {
  const caixa = useRef<HTMLDivElement>(null);
  const grafico = useRef<EChartsType | null>(null);
  useEffect(() => {
    if (!caixa.current) return;
    const g = init(caixa.current, undefined, { renderer: "canvas" });
    grafico.current = g;
    const obs = new ResizeObserver(() => g.resize());
    obs.observe(caixa.current);
    return () => {
      obs.disconnect();
      g.dispose();
      grafico.current = null;
    };
  }, []);
  useEffect(() => {
    grafico.current?.setOption(opcao(), { notMerge: true });
  }, deps);
  return caixa;
}

const base = () => {
  const fonte = getComputedStyle(document.body).fontFamily;
  return {
    animation: false,
    textStyle: { fontFamily: fonte },
    tooltip: {
      trigger: "axis",
      backgroundColor: token("surface"),
      borderColor: token("border-strong"),
      textStyle: { color: token("text"), fontFamily: fonte },
      valueFormatter: (v: unknown) => (typeof v === "number" ? brl.format(v) : "-"),
    },
    legend: {
      bottom: 0,
      textStyle: { color: token("text-2"), fontSize: 11 },
      icon: "roundRect",
    },
    grid: { left: 8, right: 8, top: 12, bottom: 36, containLabel: true },
    yAxis: {
      type: "value",
      axisLabel: {
        color: token("text-3"),
        fontSize: 11,
        formatter: (v: number) => compacto.format(v),
      },
      splitLine: { lineStyle: { color: token("border") } },
    },
  };
};

/** Barras empilhadas por mes: quanto cada plano tira do caixa. */
export function GraficoDeParcelas({
  meses,
}: {
  meses: {
    mes: string;
    por_plano: { plano_id: string; descricao: string; valor: string }[];
  }[];
}) {
  const planos = new Map<string, string>();
  for (const m of meses) for (const p of m.por_plano) planos.set(p.plano_id, p.descricao);
  const caixa = useGrafico(
    () => ({
      ...base(),
      xAxis: {
        type: "category",
        data: meses.map((m) => rotuloDoMes(m.mes)),
        axisLabel: { color: token("text-3"), fontSize: 11 },
        axisLine: { lineStyle: { color: token("border") } },
      },
      series: [...planos.entries()].map(([id, nome], k) => ({
        name: nome,
        type: "bar",
        stack: "total",
        barMaxWidth: 28,
        itemStyle: { color: token(`series-${(k % 6) + 1}`) },
        data: meses.map((m) =>
          Number(m.por_plano.find((p) => p.plano_id === id)?.valor ?? 0),
        ),
      })),
    }),
    [meses],
  );
  return (
    <div
      ref={caixa}
      role="img"
      aria-label={`Parcelas por mês: ${meses.map((m) => `${rotuloDoMes(m.mes)} ${m.por_plano.reduce((s, p) => s + Number(p.valor), 0).toFixed(2)}`).join(", ")}`}
      style={{ height: 260 }}
    />
  );
}

/** Linha do saldo projetado com barras de entradas e saidas; mes negativo destacado. */
export function GraficoDoFluxo({
  meses,
  negativo,
}: {
  meses: { mes: string; entradas: string; saidas: string; saldo_final: string }[];
  negativo: string | null;
}) {
  const caixa = useGrafico(() => {
    const rotulos = meses.map((m) => rotuloDoMes(m.mes));
    const idx = negativo ? meses.findIndex((m) => m.mes === negativo) : -1;
    return {
      ...base(),
      xAxis: {
        type: "category",
        data: rotulos,
        axisLabel: { color: token("text-3"), fontSize: 11 },
        axisLine: { lineStyle: { color: token("border") } },
      },
      series: [
        {
          name: "Entradas",
          type: "bar",
          barMaxWidth: 18,
          itemStyle: { color: token("up"), opacity: 0.55 },
          data: meses.map((m) => Number(m.entradas)),
        },
        {
          name: "Saídas",
          type: "bar",
          barMaxWidth: 18,
          itemStyle: { color: token("down"), opacity: 0.55 },
          data: meses.map((m) => -Number(m.saidas)),
        },
        {
          name: "Saldo no fim do mês",
          type: "line",
          symbolSize: 7,
          lineStyle: { color: token("series-1"), width: 2.4 },
          itemStyle: { color: token("series-1") },
          data: meses.map((m) => Number(m.saldo_final)),
          ...(idx >= 0
            ? {
                markArea: {
                  silent: true,
                  itemStyle: { color: token("down-soft") },
                  data: [[{ xAxis: rotulos[idx] }, { xAxis: rotulos.at(-1) }]],
                },
              }
            : {}),
        },
      ],
    };
  }, [meses, negativo]);
  return (
    <div
      ref={caixa}
      role="img"
      aria-label={`Saldo projetado: ${meses.map((m) => `${rotuloDoMes(m.mes)} ${m.saldo_final}`).join(", ")}`}
      style={{ height: 300 }}
    />
  );
}

/** Evolucao mensal do patrimonio liquido; o mes corrente (parcial) tracejado. */
export function GraficoDoPatrimonio({
  pontos,
}: {
  pontos: {
    mes: string;
    patrimonio_liquido: string;
    investimentos: string;
    contas: string;
    parcial: boolean;
  }[];
}) {
  const caixa = useGrafico(() => {
    const rotulos = pontos.map((p) => rotuloDoMes(p.mes));
    return {
      ...base(),
      xAxis: {
        type: "category",
        data: rotulos,
        axisLabel: { color: token("text-3"), fontSize: 11 },
        axisLine: { lineStyle: { color: token("border") } },
      },
      series: [
        {
          name: "Investimentos",
          type: "bar",
          stack: "ativos",
          barMaxWidth: 22,
          itemStyle: { color: token("series-2"), opacity: 0.7 },
          data: pontos.map((p) => Number(p.investimentos)),
        },
        {
          name: "Contas",
          type: "bar",
          stack: "ativos",
          barMaxWidth: 22,
          itemStyle: { color: token("series-3"), opacity: 0.7 },
          data: pontos.map((p) => Number(p.contas)),
        },
        {
          name: "Patrimônio líquido",
          type: "line",
          symbolSize: 7,
          lineStyle: { color: token("series-1"), width: 2.4 },
          itemStyle: { color: token("series-1") },
          data: pontos.map((p) => ({
            value: Number(p.patrimonio_liquido),
            itemStyle: p.parcial ? { borderType: "dashed", opacity: 0.6 } : undefined,
          })),
        },
      ],
    };
  }, [pontos]);
  return (
    <div
      ref={caixa}
      role="img"
      aria-label={`Patrimônio líquido por mês: ${pontos.map((p) => `${rotuloDoMes(p.mes)} ${p.patrimonio_liquido}${p.parcial ? " (parcial)" : ""}`).join(", ")}`}
      style={{ height: 280 }}
    />
  );
}
