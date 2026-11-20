"use client";

import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { init, use, type EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

const token = (nome: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(`--${nome}`).trim();
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Barras horizontais das maiores categorias de despesa do mes. */
export function GraficoDeCategorias({
  categorias,
}: {
  categorias: { nome: string; valor: string }[];
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const grafico = useRef<EChartsType | null>(null);

  useEffect(() => {
    if (!caixa.current) return;
    const g = init(caixa.current, undefined, { renderer: "canvas" });
    grafico.current = g;
    const observador = new ResizeObserver(() => g.resize());
    observador.observe(caixa.current);
    return () => {
      observador.disconnect();
      g.dispose();
      grafico.current = null;
    };
  }, []);

  useEffect(() => {
    const g = grafico.current;
    if (!g) return;
    const fonte = getComputedStyle(document.body).fontFamily;
    const ordem = [...categorias].reverse();
    g.setOption(
      {
        animation: false,
        textStyle: { fontFamily: fonte },
        // Margem direita para o rotulo da maior barra caber.
        grid: { left: 8, right: 96, top: 4, bottom: 4, containLabel: true },
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "none" },
          backgroundColor: token("surface"),
          borderColor: token("border-strong"),
          textStyle: { color: token("text"), fontFamily: fonte },
          valueFormatter: (v: unknown) => (typeof v === "number" ? brl.format(v) : "-"),
        },
        xAxis: { type: "value", show: false },
        yAxis: {
          type: "category",
          data: ordem.map((c) => c.nome),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: token("text-2"), fontSize: 12 },
        },
        series: [
          {
            type: "bar",
            barMaxWidth: 18,
            itemStyle: { color: token("series-1"), borderRadius: [0, 4, 4, 0] },
            label: {
              show: true,
              position: "right",
              color: token("text-3"),
              fontSize: 11,
              formatter: (p: { value: number }) => brl.format(p.value),
            },
            data: ordem.map((c) => Number(c.valor)),
          },
        ],
      },
      { notMerge: true },
    );
  }, [categorias]);

  return (
    <div
      ref={caixa}
      role="img"
      aria-label={`Maiores categorias: ${categorias.map((c) => `${c.nome} ${brl.format(Number(c.valor))}`).join(", ")}`}
      style={{ height: Math.max(120, categorias.length * 40) }}
    />
  );
}
