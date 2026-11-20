"use client";

import Link from "next/link";
import { Card, Money, Skeleton } from "@bolsiq/ui";
import { useInsights } from "./cliente";
import { comEconomia } from "./Insights";

/** Os 3 maiores impactos anuais do mes, no dashboard. */
export function OndeOtimizar({ mes }: { mes: string }) {
  const { data } = useInsights(mes);
  const top = comEconomia(data?.insights ?? []).slice(0, 3);
  return (
    <Card
      title="Onde otimizar"
      action={
        <Link
          href="/financas/insights"
          className="text-sm text-link hover:text-link-hover"
        >
          Ver todos
        </Link>
      }
    >
      {!data ? (
        <Skeleton className="h-20" />
      ) : top.length === 0 ? (
        <p className="m-0 text-sm text-text-3">
          Nada para otimizar agora. Com mais meses de lançamentos, os insights aparecem
          aqui.
        </p>
      ) : (
        <ol aria-label="Onde otimizar" className="m-0 list-none p-0">
          {top.map((i) => (
            <li
              key={i.id}
              className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0"
            >
              <span className="flex min-w-0 flex-col">
                <span>{i.titulo}</span>
                <span className="text-xs text-text-3">{i.acao_sugerida}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <Money value={i.impacto_anual} className="font-semibold" />
                <span className="text-xs text-text-3">por ano</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
