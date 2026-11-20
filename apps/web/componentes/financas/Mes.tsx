"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@bolsiq/ui";

/** YYYY-MM somando meses. */
export function outroMes(mes: string, delta: number): string {
  const t = new Date(`${mes}-01T00:00:00Z`);
  t.setUTCMonth(t.getUTCMonth() + delta);
  return t.toISOString().slice(0, 7);
}

export const nomeDoMes = (mes: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${mes}-01T00:00:00Z`));

/** Mes anterior e seguinte, com o nome do mes no meio. */
export function SeletorDeMes({
  mes,
  onMudar,
}: {
  mes: string;
  onMudar: (m: string) => void;
}) {
  return (
    <div role="group" aria-label="Mês" className="flex items-center gap-1">
      <Button
        variant="ghost"
        className="px-2"
        aria-label="Mês anterior"
        onClick={() => onMudar(outroMes(mes, -1))}
      >
        <ChevronLeft aria-hidden="true" size={18} />
      </Button>
      <span className="min-w-[140px] text-center text-sm font-semibold first-letter:uppercase">
        {nomeDoMes(mes)}
      </span>
      <Button
        variant="ghost"
        className="px-2"
        aria-label="Próximo mês"
        onClick={() => onMudar(outroMes(mes, 1))}
      >
        <ChevronRight aria-hidden="true" size={18} />
      </Button>
    </div>
  );
}

/** Barra de progresso simples: realizado sobre planejado (ou usado sobre limite). */
export function Barra({
  valor,
  total,
  rotulo,
}: {
  valor: number;
  total: number;
  rotulo: string;
}) {
  const pct = total > 0 ? Math.min(100, (valor / total) * 100) : valor > 0 ? 100 : 0;
  const estourou = total > 0 && valor > total;
  return (
    <div
      role="meter"
      aria-label={rotulo}
      aria-valuemin={0}
      aria-valuemax={Math.max(total, valor)}
      aria-valuenow={valor}
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div
        className={estourou ? "h-full bg-down" : "h-full bg-accent"}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
