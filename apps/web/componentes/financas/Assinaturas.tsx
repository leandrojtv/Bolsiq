"use client";

import { Repeat } from "lucide-react";
import Link from "next/link";
import { custoDeOportunidade } from "@bolsiq/finance/puro";
import { Card, EmptyState, Money, Skeleton, StatTile, cn } from "@bolsiq/ui";
import { dataBr } from "./Cartoes";
import { useAssinaturas } from "./cliente";

const MARCA = {
  dispensado: "dispensada",
  ainda_uso: "ainda usa",
  vou_cancelar: "vai cancelar",
  ja_cancelei: "cancelada",
} as const;

export function PaginaDeAssinaturas() {
  const { data, isPending } = useAssinaturas();
  const oportunidade =
    data?.cdi && Number(data.total_mensal) > 0
      ? custoDeOportunidade(data.total_mensal, data.cdi)
      : null;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="m-0 text-[26px] font-bold tracking-tight">Assinaturas</h1>
      <p className="m-0 max-w-[70ch] text-sm text-text-2">
        Detectadas nos seus lançamentos: a mesma cobrança, com valor parecido, todo mês
        (pelo menos 3 vezes) ou todo ano (pelo menos 2). Para agir sobre uma, abra o card
        dela em{" "}
        <Link href="/financas/insights" className="text-link hover:text-link-hover">
          Insights
        </Link>
        .
      </p>
      {isPending || !data ? (
        <Skeleton className="h-64" />
      ) : data.assinaturas.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Repeat aria-hidden="true" size={28} />}
            title="Nenhuma assinatura detectada"
            description="Com três meses de extrato ou fatura, as cobranças que se repetem aparecem aqui."
          />
        </Card>
      ) : (
        <>
          <section
            aria-label="Total das assinaturas"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <StatTile
              label="Por mês"
              value={<Money value={data.total_mensal} />}
              subtitle="anuais divididas por 12; sem as canceladas"
            />
            <StatTile
              label="Por ano"
              value={<Money value={data.total_anual} />}
              subtitle={
                oportunidade ? (
                  <>
                    no CDI, em 10 anos:{" "}
                    <Money value={oportunidade.em_10_anos.acumulado} />
                  </>
                ) : (
                  "sem a taxa do CDI agora"
                )
              }
            />
          </section>
          <Card>
            <ul aria-label="Assinaturas detectadas" className="m-0 list-none p-0">
              {data.assinaturas.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 border-b border-border py-3 last:border-0"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold">{a.nome}</span>
                    <span className="text-xs text-text-3">
                      {a.frequencia === "mensal" ? "mensal" : "anual"} · desde{" "}
                      {dataBr(a.primeira)} · próxima {dataBr(a.proxima)}
                      {a.categoria ? ` · ${a.categoria}` : ""}
                    </span>
                    <span className="flex flex-wrap gap-2 text-xs">
                      {a.reajuste && (
                        <span className="text-warn">
                          reajuste de <Money value={a.reajuste.de} /> para{" "}
                          <Money value={a.reajuste.para} />
                        </span>
                      )}
                      {a.duplicidade.length > 0 && (
                        <span className="text-down">
                          possível duplicidade ({a.grupo})
                        </span>
                      )}
                      {a.nova && <span className="text-accent">nova</span>}
                      {a.feedback && (
                        <span className="text-text-3">{MARCA[a.feedback.acao]}</span>
                      )}
                    </span>
                  </span>
                  <span className="flex flex-col items-end">
                    <Money
                      value={a.valor_atual}
                      className={cn(
                        "font-semibold",
                        a.feedback?.acao === "ja_cancelei" && "line-through",
                      )}
                    />
                    <span className="text-xs text-text-3">
                      <Money value={a.valor_anual} /> por ano
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
