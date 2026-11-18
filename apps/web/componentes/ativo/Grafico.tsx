"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Candle, Interval } from "@bolsiq/contracts";
import {
  CompactNumber,
  formatarNumero,
  SegmentedControl,
  Skeleton,
  Switch,
  ToggleChip,
} from "@bolsiq/ui";
import { api, type Envelope } from "@/lib/api";
import {
  hojeEmSp,
  ifr,
  inicioDoPeriodo,
  mediaMovel,
  type Periodo,
} from "@/lib/indicadores-tecnicos";
import type { CotacaoAoVivo } from "./useCotacaoAoVivo";

interface Historico {
  ticker: string;
  interval: Interval;
  adjusted: boolean;
  candles: Candle[];
}

export interface GraficoProps {
  ticker: string;
  /** Historico do servidor para a primeira pintura (6M, diario, ajustado). */
  inicial: Envelope<Historico> | null;
  aoVivo: CotacaoAoVivo | null;
  compacto: boolean;
}

const PERIODOS: Periodo[] = ["1M", "6M", "1A", "5A", "Máx"];
const INTERVALOS: { value: Interval; label: string }[] = [
  { value: "1d", label: "Diário" },
  { value: "1wk", label: "Semanal" },
  { value: "1mo", label: "Mensal" },
];

/** Cores do grafico lidas dos tokens: o canvas nao entende var(--x). */
function token(nome: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${nome}`).trim();
}

export function Grafico({ ticker, inicial, aoVivo, compacto }: GraficoProps) {
  const [periodo, setPeriodo] = useState<Periodo>("6M");
  const [intervalo, setIntervalo] = useState<Interval>("1d");
  const [ajustado, setAjustado] = useState(true);
  const [mm20, setMm20] = useState(true);
  const [mm50, setMm50] = useState(true);
  const [comIfr, setComIfr] = useState(false);

  const de = inicioDoPeriodo(periodo, hojeEmSp());
  const padrao = periodo === "6M" && intervalo === "1d" && ajustado;
  const { data, isPending, isError } = useQuery({
    queryKey: ["historico", ticker, periodo, intervalo, ajustado],
    queryFn: () =>
      api<Envelope<Historico>>(
        `v1/history/${ticker}?interval=${intervalo}&from=${de}&adjusted=${ajustado}`,
      ),
    ...(padrao && inicial ? { initialData: inicial } : {}),
    staleTime: 300_000,
  });
  const velas = useMemo(() => data?.data.candles ?? [], [data]);

  const caixa = useRef<HTMLDivElement>(null);
  const grafico = useRef<IChartApi | null>(null);
  const series = useRef<Record<string, ISeriesApi<SeriesType>>>({});
  const [legenda, setLegenda] = useState<Candle | null>(null);
  const velasPorData = useRef(new Map<string, Candle>());

  // Cria o grafico uma vez por modo (compacto ou completo).
  useEffect(() => {
    if (!caixa.current) return;
    const c = createChart(caixa.current, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: token("text-3"),
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: token("border") },
      },
      grid: { vertLines: { visible: false }, horzLines: { color: token("border") } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: "pt-BR", priceFormatter: (p: number) => formatarNumero(p) },
      handleScroll: !compacto,
      handleScale: !compacto,
    });
    grafico.current = c;

    if (compacto) {
      series.current = {
        area: c.addSeries(AreaSeries, {
          lineColor: token("up"),
          topColor: token("up-soft"),
          bottomColor: token("bg"),
          lineWidth: 2,
          priceLineVisible: false,
        }),
      };
    } else {
      const velasSerie = c.addSeries(CandlestickSeries, {
        upColor: token("up"),
        downColor: token("down"),
        wickUpColor: token("up"),
        wickDownColor: token("down"),
        borderVisible: false,
      });
      const volume = c.addSeries(HistogramSeries, {
        priceScaleId: "volume",
        priceFormat: { type: "volume" },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      c.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
        visible: false,
      });
      velasSerie.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.25 } });
      series.current = {
        velas: velasSerie,
        volume,
        mm20: c.addSeries(LineSeries, {
          color: token("series-1"),
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        }),
        mm50: c.addSeries(LineSeries, {
          color: token("series-2"),
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        }),
      };
      c.subscribeCrosshairMove((p) => {
        const v = p.time ? velasPorData.current.get(p.time as string) : undefined;
        setLegenda(v ?? null);
      });
    }
    return () => {
      c.remove();
      grafico.current = null;
      series.current = {};
    };
  }, [compacto]);

  // Dados: velas, volume, medias e IFR.
  useEffect(() => {
    const c = grafico.current;
    const s = series.current;
    if (!c || velas.length === 0) return;
    velasPorData.current = new Map(velas.map((v) => [v.date, v]));
    const fech = velas.map((v) => Number(v.close));

    if (s.area) {
      s.area.setData(velas.map((v) => ({ time: v.date, value: Number(v.close) })));
    } else {
      s.velas?.setData(
        velas.map((v) => ({
          time: v.date,
          open: Number(v.open),
          high: Number(v.high),
          low: Number(v.low),
          close: Number(v.close),
        })),
      );
      const subida = token("volume-up");
      const descida = token("volume-down");
      s.volume?.setData(
        velas.map((v) => ({
          time: v.date,
          value: v.volume,
          color: Number(v.close) >= Number(v.open) ? subida : descida,
        })),
      );
      const linha = (valores: (number | null)[]) =>
        valores.flatMap((x, i) =>
          x === null ? [] : [{ time: velas[i]?.date as Time, value: x }],
        );
      s.mm20?.setData(mm20 ? linha(mediaMovel(fech, 20)) : []);
      s.mm50?.setData(mm50 ? linha(mediaMovel(fech, 50)) : []);

      if (comIfr && !s.ifr) {
        s.ifr = c.addSeries(
          LineSeries,
          { color: token("series-3"), lineWidth: 2, priceLineVisible: false },
          1,
        );
        c.panes()[1]?.setHeight(90);
      }
      if (!comIfr && s.ifr) {
        c.removeSeries(s.ifr);
        delete s.ifr;
      }
      s.ifr?.setData(linha(ifr(fech, 14)));
    }
    c.timeScale().fitContent();
    setLegenda(null);
  }, [velas, mm20, mm50, comIfr, compacto]);

  // Cotacao ao vivo: atualiza a vela do dia (ou cria) sem refazer a serie.
  useEffect(() => {
    const ultima = velas.at(-1);
    if (!aoVivo || !ultima || intervalo !== "1d") return;
    const hoje = hojeEmSp(new Date(aoVivo.ts));
    if (hoje < ultima.date) return;
    const preco = Number(aoVivo.price);
    const base =
      hoje === ultima.date
        ? ultima
        : { ...ultima, open: ultima.close, high: ultima.close, low: ultima.close };
    const s = series.current;
    s.area?.update({ time: hoje as Time, value: preco });
    s.velas?.update({
      time: hoje as Time,
      open: Number(base.open),
      high: Math.max(Number(base.high), preco),
      low: Math.min(Number(base.low), preco),
      close: preco,
    });
  }, [aoVivo, velas, intervalo]);

  const mostrada = legenda ?? velas.at(-1) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <SegmentedControl
          label="Período"
          options={PERIODOS.map((p) => ({ value: p, label: p }))}
          value={periodo}
          onChange={setPeriodo}
          className={compacto ? "grid w-full grid-cols-5" : ""}
        />
        {!compacto && (
          <div className="flex flex-wrap gap-2">
            <ToggleChip swatch="series-1" pressed={mm20} onPressedChange={setMm20}>
              MM 20
            </ToggleChip>
            <ToggleChip swatch="series-2" pressed={mm50} onPressedChange={setMm50}>
              MM 50
            </ToggleChip>
            <ToggleChip swatch="series-3" pressed={comIfr} onPressedChange={setComIfr}>
              IFR 14
            </ToggleChip>
          </div>
        )}
      </div>

      {!compacto && (
        <div
          aria-live="off"
          className="flex min-h-5 flex-wrap gap-4 font-mono text-xs text-text-3"
        >
          {mostrada && (
            <>
              <span>
                A <b className="text-text">{formatarNumero(mostrada.open)}</b>
              </span>
              <span>
                Máx <b className="text-text">{formatarNumero(mostrada.high)}</b>
              </span>
              <span>
                Mín <b className="text-text">{formatarNumero(mostrada.low)}</b>
              </span>
              <span>
                F <b className="text-text">{formatarNumero(mostrada.close)}</b>
              </span>
              <span>
                Vol{" "}
                <CompactNumber value={mostrada.volume} className="font-bold text-text" />
              </span>
            </>
          )}
        </div>
      )}

      <div className="relative">
        <div
          ref={caixa}
          role="img"
          aria-label={`Gráfico de preço de ${ticker}, período ${periodo}`}
          className={compacto ? "h-[200px]" : "h-[420px]"}
        />
        {isPending && <Skeleton className="absolute inset-0" />}
        {isError && (
          <p
            role="alert"
            className="absolute inset-0 m-0 flex items-center justify-center text-down"
          >
            Não foi possível carregar o histórico.
          </p>
        )}
        {!isPending && velas.length === 0 && !isError && (
          <p className="absolute inset-0 m-0 flex items-center justify-center text-text-3">
            Sem pregões no período.
          </p>
        )}
      </div>

      {!compacto && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-3">
          <SegmentedControl
            label="Intervalo"
            options={INTERVALOS}
            value={intervalo}
            onChange={setIntervalo}
          />
          <Switch
            checked={ajustado}
            onCheckedChange={setAjustado}
            label="Ajustado por proventos"
          />
        </div>
      )}
    </div>
  );
}
