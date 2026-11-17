"use client";

import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { Card, Skeleton } from "@bolsiq/ui";
import { buscarCotacoes } from "@/lib/api";
import type { Indicadores } from "@/lib/analytics";
import { Cabecalho, TopoMobile } from "./Cabecalho";
import { Detalhes } from "./Detalhes";
import type { GraficoProps } from "./Grafico";
import type { SinaisTecnicos } from "@bolsiq/analytics/puro";
import {
  GradeDeIndicadores,
  LateralMobile,
  PrecoJusto,
  SinaisTecnicosCard,
} from "./Lateral";
import type { DadosDoAtivo } from "./tipos";
import { useCotacaoAoVivo } from "./useCotacaoAoVivo";

// Lightweight Charts so no cliente, e fora do bundle inicial: o cabecalho e os
// indicadores aparecem antes do grafico carregar.
const Grafico = dynamic<GraficoProps>(() => import("./Grafico").then((m) => m.Grafico), {
  ssr: false,
  loading: () => <Skeleton className="h-[200px] md:h-[500px]" />,
});

const CELULAR = "(max-width: 767px)";
function useCelular(): boolean {
  return useSyncExternalStore(
    (aviso) => {
      const mq = window.matchMedia(CELULAR);
      mq.addEventListener("change", aviso);
      return () => mq.removeEventListener("change", aviso);
    },
    () => window.matchMedia(CELULAR).matches,
    () => false,
  );
}

export function PaginaDoAtivo({
  dados,
  historico,
  indicadores,
  tecnicos,
}: {
  dados: DadosDoAtivo;
  historico: GraficoProps["inicial"];
  indicadores: Indicadores | null;
  tecnicos: SinaisTecnicos | null;
}) {
  const ativo = dados.ativo.data;
  const celular = useCelular();
  const aoVivo = useCotacaoAoVivo(ativo.ticker);

  // Cotacao revalidada a cada minuto com a aba visivel. A leitura tambem
  // dispara o read-through no market-data, que emite o evento do stream.
  const { data: cotacoes } = useQuery({
    queryKey: ["cotacoes", [ativo.ticker]],
    queryFn: () => buscarCotacoes([ativo.ticker]),
    ...(dados.cotacao ? { initialData: dados.cotacao } : {}),
    refetchInterval: 60_000,
  });
  const base = cotacoes?.data[0] ?? null;
  const cotacao =
    base && aoVivo
      ? { ...base, price: aoVivo.price, change: aoVivo.change, quoted_at: aoVivo.ts }
      : base;

  return (
    <>
      <TopoMobile ticker={ativo.ticker} />
      <Cabecalho ativo={ativo} cotacao={cotacao} meta={cotacoes?.meta ?? null} />
      {/* Grade: grafico e indicadores lado a lado a partir de xl; preco justo e
          sinais tecnicos numa linha abaixo, para a lateral nao ficar mais alta
          que o grafico e abrir um vazio antes de Proventos. */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Gráfico de preço" className="min-w-0">
          {celular ? (
            <Grafico ticker={ativo.ticker} inicial={historico} aoVivo={aoVivo} compacto />
          ) : (
            <Card>
              <Grafico
                ticker={ativo.ticker}
                inicial={historico}
                aoVivo={aoVivo}
                compacto={false}
              />
            </Card>
          )}
        </section>
        <aside aria-label="Indicadores" className="@container hidden min-w-0 md:flex">
          <GradeDeIndicadores indicadores={indicadores} />
        </aside>
        <div className="hidden min-w-0 grid-cols-2 gap-5 md:grid xl:col-span-2 [&>*:only-child]:col-span-2">
          <PrecoJusto indicadores={indicadores} preco={cotacao?.price ?? null} />
          <SinaisTecnicosCard tecnicos={tecnicos} />
        </div>
      </div>
      <LateralMobile
        indicadores={indicadores}
        preco={cotacao?.price ?? null}
        tecnicos={tecnicos}
      />
      <Detalhes
        ativo={ativo}
        proventos={dados.proventos?.data ?? null}
        fundamentos={dados.fundamentos}
      />
    </>
  );
}
