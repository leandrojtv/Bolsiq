"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CircleDollarSign,
  FileText,
  Percent,
  Scale,
} from "lucide-react";
import { Card, EmptyState, SegmentedControl, cn } from "@bolsiq/ui";
import type { TipoDeRegra } from "@/lib/alertas-modelo";
import { CHAVES, listarNotificacoes, marcarLidas, quando } from "./cliente";

const ICONE: Record<TipoDeRegra, { icone: typeof ArrowUp; cor: string }> = {
  preco_acima: { icone: ArrowUp, cor: "bg-up-soft text-up-strong" },
  preco_abaixo: { icone: ArrowDown, cor: "bg-down-soft text-down-strong" },
  variacao_diaria: { icone: Percent, cor: "bg-down-soft text-down-strong" },
  abaixo_graham: { icone: Scale, cor: "bg-warn-bg text-warn" },
  abaixo_bazin: { icone: Scale, cor: "bg-warn-bg text-warn" },
  dy_acima: { icone: Percent, cor: "bg-up-soft text-up-strong" },
  provento_anunciado: {
    icone: CircleDollarSign,
    cor: "bg-accent-soft text-accent-soft-text",
  },
  data_com_proxima: { icone: CalendarClock, cor: "bg-accent-soft text-accent-soft-text" },
  demonstrativo_publicado: {
    icone: FileText,
    cor: "bg-series-3-soft text-series-3-strong",
  },
};

type Filtro = "todas" | "nao_lidas";

/** Central de notificacoes. `destacar` vem do link do e-mail (?n=<id>) e e marcada como lida. */
export function Central({ destacar }: { destacar?: string }) {
  const cliente = useQueryClient();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const { data, isPending } = useQuery({
    queryKey: [...CHAVES.notificacoes, filtro],
    queryFn: () => listarNotificacoes(filtro === "nao_lidas"),
  });
  const marcar = useMutation({
    mutationFn: marcarLidas,
    onSuccess: async ({ nao_lidas }) => {
      cliente.setQueryData(CHAVES.naoLidas, nao_lidas);
      await cliente.invalidateQueries({ queryKey: CHAVES.notificacoes });
    },
  });

  useEffect(() => {
    if (destacar) marcar.mutate([destacar]);
    // So na abertura da pagina.
  }, [destacar]);

  const itens = data?.itens ?? [];
  return (
    <Card
      aria-label="Central de notificações"
      title="Notificações"
      action={
        <SegmentedControl<Filtro>
          label="Filtro"
          value={filtro}
          onChange={setFiltro}
          options={[
            { value: "todas", label: "Todas" },
            { value: "nao_lidas", label: "Não lidas" },
          ]}
        />
      }
      className="min-w-0 flex-[1_1_360px]"
    >
      {!isPending && itens.length === 0 ? (
        <EmptyState
          title={filtro === "nao_lidas" ? "Nada por ler" : "Nenhuma notificação"}
          description="Quando uma regra disparar, o aviso aparece aqui."
        />
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {itens.map((n) => {
            const visual = n.tipo ? ICONE[n.tipo] : null;
            const Icone = visual?.icone ?? CircleDollarSign;
            return (
              <li key={n.id} className="border-t border-border">
                <Link
                  href={n.ticker ? `/ativo/${n.ticker}` : "/alertas"}
                  onClick={() => !n.lida && marcar.mutate([n.id])}
                  className={cn(
                    "flex gap-3 px-2 py-3 text-text hover:bg-surface-2",
                    n.id === destacar && "bg-surface-2",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-9 flex-none items-center justify-center rounded-control",
                      visual?.cor ?? "bg-accent-soft text-accent-soft-text",
                    )}
                  >
                    <Icone size={16} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex justify-between gap-2">
                      <span className={n.lida ? "font-normal" : "font-semibold"}>
                        {n.titulo}
                      </span>
                      <time
                        dateTime={n.criada_em}
                        className="text-xs whitespace-nowrap text-text-3"
                      >
                        {quando(n.criada_em)}
                      </time>
                    </span>
                    <span className="text-[13px] leading-snug text-text-2">
                      {n.corpo}
                    </span>
                  </span>
                  {!n.lida && (
                    <span className="mt-1.5 size-2 flex-none rounded-full bg-accent">
                      <span className="sr-only">Não lida</span>
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        onClick={() => marcar.mutate(undefined)}
        disabled={(data?.nao_lidas ?? 0) === 0}
        className="h-10 rounded-control border border-border-strong bg-transparent text-text disabled:opacity-50"
      >
        Marcar todas como lidas
      </button>
    </Card>
  );
}
