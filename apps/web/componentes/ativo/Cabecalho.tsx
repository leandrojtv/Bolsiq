"use client";

import Link from "next/link";
import { Bell, ChevronLeft, Star } from "lucide-react";
import type { AssetDetail, LiveQuote, ResponseMeta } from "@bolsiq/contracts";
import { Button, Change, Price, SourceLine, StaleBadge } from "@bolsiq/ui";
import { useWatchlist } from "../watchlist";
import { nomeDaFonte, TIPO_DO_ATIVO } from "./tipos";

export interface CabecalhoProps {
  ativo: AssetDetail;
  cotacao: LiveQuote | null;
  meta: ResponseMeta | null;
}

/** Topo do celular (AtivoMobile.dc.html): voltar, ticker, watchlist e alerta. */
export function TopoMobile({ ticker }: { ticker: string }) {
  const { contem, alternar } = useWatchlist();
  const na = contem(ticker);
  return (
    <header className="-mx-4 -mt-5 flex items-center justify-between px-3 pt-3 pb-2 md:hidden">
      <Link
        href="/"
        aria-label="Voltar"
        className="flex size-touch items-center justify-center text-text"
      >
        <ChevronLeft aria-hidden="true" size={20} />
      </Link>
      <span className="font-mono text-base font-bold">{ticker}</span>
      <div className="flex">
        <button
          type="button"
          aria-pressed={na}
          aria-label={na ? "Remover da watchlist" : "Adicionar à watchlist"}
          onClick={() => alternar(ticker)}
          className="flex size-touch items-center justify-center text-text"
        >
          <Star
            aria-hidden="true"
            size={20}
            className={na ? "fill-warn text-warn" : ""}
          />
        </button>
        <Link
          href={`/alertas?t=${ticker}`}
          aria-label="Criar alerta"
          className="flex size-touch items-center justify-center text-text"
        >
          <Bell aria-hidden="true" size={20} />
        </Link>
      </div>
    </header>
  );
}

export function Cabecalho({ ativo, cotacao, meta }: CabecalhoProps) {
  const { contem, alternar } = useWatchlist();
  const na = contem(ativo.ticker);
  const tipo = TIPO_DO_ATIVO[ativo.kind] ?? ativo.kind;

  return (
    <section
      aria-label="Cabeçalho do ativo"
      className="flex flex-wrap items-end justify-between gap-5"
    >
      <div className="flex flex-col gap-1.5">
        <div className="hidden flex-wrap items-center gap-2.5 md:flex">
          <h1 className="m-0 font-mono text-[30px] font-bold tracking-tight">
            {ativo.ticker}
          </h1>
          <span className="text-base text-text-2">{ativo.name}</span>
          <span className="rounded-chip bg-surface-2 px-2 py-1 text-xs text-text-2">
            {tipo}
          </span>
          {ativo.sector && (
            <span className="rounded-chip bg-surface-2 px-2 py-1 text-xs text-text-2">
              {ativo.sector}
            </span>
          )}
        </div>
        <span className="text-text-2 md:hidden">
          <h1 className="sr-only">{ativo.ticker}</h1>
          {ativo.name} · {tipo}
        </span>
        {cotacao ? (
          <>
            <div className="flex flex-wrap items-baseline gap-3.5">
              <Price
                value={cotacao.price}
                className="text-[34px] font-semibold md:text-[40px]"
              />
              <Change
                value={cotacao.change}
                percent={Number(cotacao.change_percent) / 100}
                className="font-semibold md:text-lg"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {meta && (
                <StaleBadge delayMinutes={meta.delay_minutes} stale={cotacao.stale} />
              )}
              <SourceLine
                source={nomeDaFonte(cotacao.provenance.source)}
                fetchedAt={cotacao.provenance.fetched_at}
              />
            </div>
          </>
        ) : (
          <p className="m-0 text-text-3">Sem cotação disponível.</p>
        )}
      </div>
      <div className="hidden flex-wrap gap-2.5 md:flex">
        <Button aria-pressed={na} onClick={() => alternar(ativo.ticker)}>
          {na ? "✓ Na watchlist" : "+ Watchlist"}
        </Button>
        <Button asChild>
          <Link href={`/comparar?t=${ativo.ticker}`}>Comparar</Link>
        </Button>
        <Button asChild variant="primary">
          <Link href={`/alertas?t=${ativo.ticker}`}>Criar alerta</Link>
        </Button>
      </div>
    </section>
  );
}
