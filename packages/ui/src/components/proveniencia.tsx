import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.js";
import { formatarAtraso, formatarHorario } from "../lib/formato.js";

export interface StaleBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** `meta.delay_minutes` da resposta do /v1. */
  delayMinutes: number;
  /** `meta.stale`: a fonte falhou e o valor e o ultimo conhecido. */
  stale?: boolean;
}

/**
 * Selo de atraso. Sem atraso e sem `stale`, nao renderiza: dado em tempo real
 * nao precisa de aviso. `stale` tem prioridade sobre o atraso, porque e o
 * aviso mais grave.
 */
export function StaleBadge({
  delayMinutes,
  stale = false,
  className,
  ...resto
}: StaleBadgeProps) {
  if (!stale && delayMinutes <= 0) return null;
  const texto = stale
    ? "Dado desatualizado"
    : `Atraso de ${formatarAtraso(delayMinutes)}`;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-chip bg-warn-bg px-2 py-0.5 text-xs text-warn",
        className,
      )}
      {...resto}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-warn" />
      {texto}
    </span>
  );
}

export interface SourceLineProps extends HTMLAttributes<HTMLSpanElement> {
  /** Nome legivel da fonte, ex. "B3 via brapi". */
  source: string;
  /** `meta.fetched_at`, ISO em UTC. */
  fetchedAt: string;
  /** Referencia de "hoje" para decidir se mostra a data; injetavel em teste. */
  now?: Date;
}

/** "Fonte: B3 via brapi · atualizado 14:52", com a hora em America/Sao_Paulo. */
export function SourceLine({
  source,
  fetchedAt,
  now,
  className,
  ...resto
}: SourceLineProps) {
  return (
    <span className={cn("text-xs text-text-3", className)} {...resto}>
      Fonte: {source} · atualizado{" "}
      <time dateTime={fetchedAt}>{formatarHorario(fetchedAt, now)}</time>
    </span>
  );
}
