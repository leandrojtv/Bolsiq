"use client";

import { LineChart } from "echarts/charts";
import { GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { init, use, type EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { formatarNumero, formatarPercentual } from "@bolsiq/ui";

// So o que o grafico usa: o ECharts inteiro passa de 1 MB.
use([LineChart, GridComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

export interface LinhaDoGrafico {
  nome: string;
  /** Token da cor (series-1, benchmark...). */
  cor: string;
  /** Tracejado do benchmark: [6, 4] e o CDI, [2, 4] o IPCA, [12, 4] o IBOV. */
  tracejado?: number[];
  pontos: { date: string; valor: number }[];
}

const MES = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });

/** Rotulo do eixo de tempo em pt-BR: o ano em janeiro, o mes nos demais. */
function rotuloDeData(valor: number): string {
  const d = new Date(valor);
  return d.getUTCMonth() === 0
    ? String(d.getUTCFullYear())
    : MES.format(d).replace(".", "");
}

function token(nome: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${nome}`).trim();
}

export function GraficoDeLinhas({
  linhas,
  rotulo,
  altura,
  formato,
  referencia,
}: {
  linhas: LinhaDoGrafico[];
  rotulo: string;
  altura: number;
  formato: "base100" | "percentual";
  /** Linha de referencia tracejada (100 na base 100, 0 no drawdown). */
  referencia?: number;
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
    const texto3 = token("text-3");
    const borda = token("border");
    const fonte = getComputedStyle(document.body).fontFamily;
    const rotuloY = (v: number) =>
      formato === "percentual"
        ? formatarPercentual(v, { casas: 0 })
        : formatarNumero(v, 0);
    g.setOption(
      {
        animation: false,
        textStyle: { fontFamily: fonte },
        grid: { left: 8, right: 52, top: 12, bottom: 24, containLabel: false },
        tooltip: {
          trigger: "axis",
          backgroundColor: token("surface"),
          borderColor: token("border-strong"),
          textStyle: { color: token("text"), fontFamily: fonte },
          valueFormatter: (v: unknown) =>
            typeof v === "number"
              ? formato === "percentual"
                ? formatarPercentual(v, { casas: 1 })
                : formatarNumero(v, 1)
              : "—",
        },
        xAxis: {
          type: "time",
          axisLine: { lineStyle: { color: borda } },
          axisLabel: {
            color: texto3,
            fontSize: 11,
            hideOverlap: true,
            formatter: rotuloDeData,
          },
          splitLine: { show: false },
        },
        yAxis: {
          type: "value",
          position: "right",
          scale: true,
          axisLabel: { color: texto3, fontSize: 11, formatter: rotuloY },
          splitLine: { lineStyle: { color: borda } },
        },
        series: linhas.map((l, i) => ({
          name: l.nome,
          type: "line",
          showSymbol: false,
          smooth: false,
          z: l.tracejado ? 1 : 2,
          lineStyle: {
            color: token(l.cor),
            width: l.tracejado ? 1.6 : 2.4,
            type: l.tracejado ?? "solid",
          },
          itemStyle: { color: token(l.cor) },
          data: l.pontos.map((p) => [p.date, p.valor]),
          ...(i === 0 && referencia !== undefined
            ? {
                markLine: {
                  silent: true,
                  symbol: "none",
                  label: { show: false },
                  lineStyle: { color: token("border-strong"), type: [4, 4] },
                  data: [{ yAxis: referencia }],
                },
              }
            : {}),
        })),
      },
      { notMerge: true },
    );
  }, [linhas, formato, referencia]);

  return (
    <div
      ref={caixa}
      role="img"
      aria-label={rotulo}
      style={{ height: altura }}
      className="w-full"
    />
  );
}
