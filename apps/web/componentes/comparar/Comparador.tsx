"use client";

import { useQuery } from "@tanstack/react-query";
import { Link2, X } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  MAX_COMPARADOS,
  type PeriodoDeComparacao,
  type PontoDeNivel,
} from "@bolsiq/analytics/puro";
import {
  Button,
  Card,
  CompactNumber,
  EmptyState,
  formatarNumero,
  formatarPercentual,
  SegmentedControl,
  Skeleton,
  ToggleChip,
  cn,
} from "@bolsiq/ui";
import type { Comparacao, SerieComparada } from "@/lib/comparar";
import { CampoDeBusca } from "../CampoDeBusca";
import type { LinhaDoGrafico } from "./GraficoDeLinhas";

const GraficoDeLinhas = dynamic(
  () => import("./GraficoDeLinhas").then((m) => m.GraficoDeLinhas),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[300px]" />,
  },
);

/** Cor fixa por posicao: o primeiro ativo e sempre a serie 1. */
const CORES = ["series-1", "series-2", "series-3", "series-4", "series-5", "series-6"];
const FUNDO_DA_COR = [
  "bg-series-1",
  "bg-series-2",
  "bg-series-3",
  "bg-series-4",
  "bg-series-5",
  "bg-series-6",
];

const BENCHMARKS = [
  { id: "CDI", tracejado: [6, 4] },
  { id: "IPCA", tracejado: [2, 4] },
  { id: "IBOV", tracejado: [12, 4] },
] as const;

const PERIODOS: PeriodoDeComparacao[] = ["6M", "1A", "2A", "5A", "Máx"];

function Tracejado({ padrao }: { padrao: readonly number[] }) {
  return (
    <svg width="16" height="4" aria-hidden="true" className="text-benchmark">
      <line
        x1="0"
        y1="2"
        x2="16"
        y2="2"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={padrao.join(" ")}
      />
    </svg>
  );
}

/** Serie de drawdown (queda desde o pico) a partir dos niveis. */
function rebaixamento(pontos: PontoDeNivel[]): PontoDeNivel[] {
  let pico = 0;
  return pontos.map((p) => {
    pico = Math.max(pico, p.valor);
    return { date: p.date, valor: pico > 0 ? p.valor / pico - 1 : 0 };
  });
}

function valorDaTabela(v: number | null, formato: "razao" | "percentual" | "moeda") {
  if (v === null) return "—";
  if (formato === "percentual") return formatarPercentual(v, { casas: 1 });
  if (formato === "moeda") return <CompactNumber value={v} prefix="R$ " />;
  return formatarNumero(v);
}

export function Comparador({
  ids,
  periodo,
  inicial,
}: {
  ids: string[];
  periodo: PeriodoDeComparacao;
  inicial: Comparacao;
}) {
  const router = useRouter();
  const caminho = usePathname();
  const [bench, setBench] = useState<Record<string, boolean>>({
    CDI: true,
    IPCA: false,
    IBOV: true,
  });
  const [copiado, setCopiado] = useState(false);

  const { data, isFetching } = useQuery({
    queryKey: ["comparar", ids.join(","), periodo],
    queryFn: async () =>
      (
        await fetch(`/api/comparar?t=${ids.join(",")}&p=${periodo}`)
      ).json() as Promise<Comparacao>,
    initialData: inicial,
    staleTime: 300_000,
  });

  const navegar = (novosIds: string[], novoPeriodo = periodo) => {
    const p = new URLSearchParams();
    if (novosIds.length > 0) p.set("t", novosIds.join(","));
    p.set("p", novoPeriodo);
    router.replace(`${caminho}?${p.toString()}`, { scroll: false });
  };

  const itens = data.itens;
  const linhas: LinhaDoGrafico[] = useMemo(
    () => [
      ...BENCHMARKS.filter((b) => bench[b.id]).map((b) => ({
        nome: b.id,
        cor: "benchmark",
        tracejado: [...b.tracejado],
        pontos: data.benchmarks.find((s) => s.id === b.id)?.pontos ?? [],
      })),
      ...itens.map((s, i) => ({
        nome: s.rotulo,
        cor: CORES[i] as string,
        pontos: s.pontos,
      })),
    ],
    [itens, data.benchmarks, bench],
  );
  const quedas: LinhaDoGrafico[] = useMemo(
    () =>
      itens.map((s, i) => ({
        nome: s.rotulo,
        cor: CORES[i] as string,
        pontos: rebaixamento(s.pontos),
      })),
    [itens],
  );

  const copiar = async () => {
    await navigator.clipboard.writeText(window.location.href).catch(() => undefined);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-[26px] font-bold tracking-tight">Comparador</h1>
          <p className="m-0 text-text-3">
            Até 6 ativos: ações, FIIs, BDRs, ETFs, fundos e índices na mesma tela.
          </p>
        </div>
        <Button onClick={() => void copiar()} disabled={ids.length === 0}>
          <Link2 aria-hidden="true" size={16} />
          <span aria-live="polite">
            {copiado ? "Link copiado" : "Copiar link da comparação"}
          </span>
        </Button>
      </div>

      <section
        aria-label="Ativos comparados"
        className="flex flex-wrap items-center gap-2.5"
      >
        {itens.map((s, i) => (
          <div
            key={s.id}
            title={s.nome}
            className="inline-flex h-touch items-center gap-2.5 rounded-control border border-border-input bg-surface pr-2 pl-3.5"
          >
            <span
              aria-hidden="true"
              className={cn("size-2.5 rounded-full", FUNDO_DA_COR[i])}
            />
            <span className="max-w-40 truncate font-mono font-semibold">{s.rotulo}</span>
            <span className="text-xs text-text-3">{s.classe}</span>
            <button
              type="button"
              aria-label={`Remover ${s.rotulo}`}
              onClick={() => navegar(ids.filter((x) => x !== s.id))}
              className="relative inline-flex size-8 items-center justify-center rounded-chip text-text-3 after:absolute after:-inset-1.5 after:content-[''] hover:text-text"
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
        ))}
        {ids.length < MAX_COMPARADOS && (
          <CampoDeBusca
            id="adicionar-ao-comparador"
            rotulo="Adicionar ativo, fundo ou índice"
            placeholder="+ Adicionar ativo, fundo ou índice"
            amplo
            className="max-w-sm min-w-60"
            onEscolher={(o) => {
              if (!ids.includes(o.id)) navegar([...ids, o.id]);
            }}
          />
        )}
      </section>

      {ids.length === 0 ? (
        <Card>
          <EmptyState
            title="Nada para comparar ainda"
            description="Adicione até 6 ativos pela busca: ações, FIIs, BDRs, ETFs, fundos (pelo nome ou CNPJ) e índices."
            action={
              <Button
                variant="primary"
                onClick={() => navegar(["PETR4", "VALE3", "IBOV"])}
              >
                Comparar PETR4, VALE3 e IBOV
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <Card aria-busy={isFetching} className="gap-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="m-0 text-base font-semibold">
                Rentabilidade acumulada{" "}
                <span className="font-normal text-text-3">base 100</span>
              </h2>
              <div className="flex flex-wrap gap-2.5">
                <div role="group" aria-label="Benchmarks" className="flex gap-1.5">
                  {BENCHMARKS.map((b) => (
                    <ToggleChip
                      key={b.id}
                      pressed={bench[b.id] ?? false}
                      onPressedChange={(v) => setBench({ ...bench, [b.id]: v })}
                      icon={<Tracejado padrao={b.tracejado} />}
                    >
                      {b.id}
                    </ToggleChip>
                  ))}
                </div>
                <SegmentedControl
                  label="Período"
                  options={PERIODOS.map((p) => ({ value: p, label: p }))}
                  value={periodo}
                  onChange={(p) => navegar(ids, p)}
                />
              </div>
            </div>
            <GraficoDeLinhas
              linhas={linhas}
              altura={300}
              formato="base100"
              referencia={100}
              rotulo="Rentabilidade acumulada dos ativos comparados com benchmarks"
            />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5">
              {itens.map((s, i) => (
                <CartaoDeRetorno key={s.id} serie={s} cor={FUNDO_DA_COR[i] as string} />
              ))}
            </div>
            <p className="m-0 text-xs text-text-3">
              Ativos ajustados por proventos; fundos pela cota (CVM); CDI e IPCA
              acumulados (BCB); IBOV
              {data.benchmarks.find((b) => b.id === "IBOV")?.fonte?.includes("BOVA11")
                ? " pelo BOVA11, como aproximação"
                : ""}
              .
            </p>
          </Card>

          <div className="flex flex-wrap items-start gap-5">
            <Card
              className="min-w-0 flex-[999_1_560px]"
              aria-label="Indicadores lado a lado"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="m-0 text-base font-semibold">Indicadores lado a lado</h2>
                <span className="text-xs text-text-3">
                  <span
                    aria-hidden="true"
                    className="mr-1 inline-block size-2.5 rounded-[3px] border border-up bg-up-soft align-[-1px]"
                  />
                  melhor da linha
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-[13px]">
                  <caption className="sr-only">
                    Indicadores dos ativos comparados; o melhor de cada linha em destaque
                  </caption>
                  <thead>
                    <tr className="text-text-3">
                      <th scope="col" className="p-2 text-left font-medium">
                        Indicador
                      </th>
                      {itens.map((s) => (
                        <th
                          key={s.id}
                          scope="col"
                          className="p-2 text-right font-mono font-semibold text-text"
                        >
                          {s.rotulo}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.tabela.map((l) => (
                      <tr key={l.indicador} className="border-t border-border">
                        <th
                          scope="row"
                          className="px-2 py-2.5 text-left font-normal text-text-2"
                        >
                          {l.rotulo}
                        </th>
                        {l.valores.map((v, i) => {
                          const melhor = l.melhores.includes(i);
                          return (
                            <td
                              key={itens[i]?.id ?? i}
                              className="px-2 py-1.5 text-right"
                            >
                              <span
                                className={cn(
                                  "inline-block rounded-chip border px-2 py-1 font-mono tabular-nums",
                                  melhor
                                    ? "border-up bg-up-soft text-up-strong"
                                    : "border-transparent text-text",
                                )}
                              >
                                {valorDaTabela(v, l.formato)}
                                {melhor && (
                                  <span className="sr-only"> (melhor da linha)</span>
                                )}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {itens.some((s) => s.tipo !== "ativo") && (
                <p className="m-0 text-xs text-text-3">
                  Fundos e índices não têm indicadores fundamentalistas.
                </p>
              )}
            </Card>

            <Card className="min-w-0 flex-[1_1_320px]" aria-label="Risco">
              <h2 className="m-0 text-base font-semibold">Drawdown</h2>
              <GraficoDeLinhas
                linhas={quedas}
                altura={160}
                formato="percentual"
                referencia={0}
                rotulo="Drawdown dos ativos no período"
              />
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {itens.map((s, i) => (
                  <li key={s.id} className="flex justify-between gap-3 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={cn("h-[3px] w-2.5 shrink-0", FUNDO_DA_COR[i])}
                      />
                      <span className="truncate">{s.rotulo}</span>
                    </span>
                    <span className="shrink-0 font-mono text-text-2">
                      máx{" "}
                      {s.estatisticas.drawdown_maximo === null
                        ? "—"
                        : formatarPercentual(s.estatisticas.drawdown_maximo, {
                            casas: 1,
                          })}{" "}
                      · vol{" "}
                      {s.estatisticas.volatilidade_anual === null
                        ? "—"
                        : formatarPercentual(s.estatisticas.volatilidade_anual, {
                            casas: 0,
                          })}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function CartaoDeRetorno({ serie, cor }: { serie: SerieComparada; cor: string }) {
  const r = serie.estatisticas.retorno;
  return (
    <div className="flex flex-col gap-0.5 rounded-control bg-sidebar px-3 py-2.5">
      <span className="flex items-center gap-2 text-xs text-text-2">
        <span aria-hidden="true" className={cn("h-[3px] w-2.5", cor)} />
        <span className="truncate">{serie.rotulo}</span>
      </span>
      {serie.erro ? (
        <span className="text-xs text-text-3">{serie.erro}</span>
      ) : (
        <span
          className={cn(
            "font-mono text-lg font-semibold tabular-nums",
            r === null ? "text-text" : r >= 0 ? "text-up" : "text-down",
          )}
        >
          {r === null
            ? "—"
            : `${r >= 0 ? "▲" : "▼"} ${formatarPercentual(r, { sinal: true, casas: 1 })}`}
        </span>
      )}
    </div>
  );
}
