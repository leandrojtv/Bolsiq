"use client";

import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Card, Money, Skeleton, StatTile, cn } from "@bolsiq/ui";
import { useFluxo } from "./cliente";
import { ROTULO } from "./Contas";
import { CAMPO } from "../conta/campos";
import { GraficoDoFluxo } from "./Graficos";
import { nomeDoMes } from "./Mes";

export function PaginaDoFluxo() {
  const [meses, setMeses] = useState(6);
  const { data, isPending } = useFluxo(meses);
  const ultimo = data?.meses.at(-1);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="m-0 text-[26px] font-bold tracking-tight">Fluxo de caixa</h1>
        <label className={ROTULO}>
          Projetar
          <select
            className={CAMPO}
            value={meses}
            onChange={(e) => setMeses(Number(e.target.value))}
          >
            {[3, 6, 9, 12].map((n) => (
              <option key={n} value={n}>
                {n} meses
              </option>
            ))}
          </select>
        </label>
      </header>
      <p className="m-0 max-w-[70ch] text-sm text-text-2">
        Saldo de hoje nas contas mais o que está previsto: receitas e despesas,
        recorrentes, parcelas de dívidas e as faturas dos cartões no vencimento.
      </p>
      {isPending || !data ? (
        <Skeleton className="h-72" />
      ) : (
        <>
          {data.primeiro_mes_negativo && (
            <p
              role="alert"
              className="m-0 flex items-center gap-2 rounded-control bg-down-soft px-3 py-2 text-sm"
            >
              <TriangleAlert aria-hidden="true" size={16} />O saldo fica negativo em{" "}
              <strong className="first-letter:uppercase">
                {nomeDoMes(data.primeiro_mes_negativo)}
              </strong>
              .
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatTile label="Saldo hoje" value={<Money value={data.saldo_inicial} />} />
            <StatTile
              label={`Saldo projetado em ${ultimo ? nomeDoMes(ultimo.mes) : ""}`}
              value={
                <Money
                  value={ultimo?.saldo_final ?? "0"}
                  className={cn(ultimo?.saldo_final.startsWith("-") && "text-down")}
                />
              }
            />
          </div>
          <Card title="Saldo projetado">
            <GraficoDoFluxo meses={data.meses} negativo={data.primeiro_mes_negativo} />
          </Card>
          <Card title="Mês a mês">
            <table aria-label="Fluxo mês a mês" className="w-full text-sm">
              <thead>
                <tr className="text-right text-xs text-text-3">
                  <th className="py-1.5 text-left font-medium">Mês</th>
                  <th className="py-1.5 font-medium">Entradas</th>
                  <th className="py-1.5 font-medium">Saídas</th>
                  <th className="py-1.5 font-medium">Saldo no fim</th>
                </tr>
              </thead>
              <tbody>
                {data.meses.map((m) => (
                  <tr
                    key={m.mes}
                    className={cn(
                      "border-t border-border text-right",
                      m.mes === data.primeiro_mes_negativo && "bg-down-soft",
                    )}
                  >
                    <td className="py-2 text-left first-letter:uppercase">
                      {nomeDoMes(m.mes)}
                    </td>
                    <td className="py-2">
                      <Money value={m.entradas} className="text-up" />
                    </td>
                    <td className="py-2">
                      <Money value={m.saidas} className="text-down" />
                    </td>
                    <td className="py-2">
                      <Money
                        value={m.saldo_final}
                        className={cn(
                          "font-semibold",
                          m.saldo_final.startsWith("-") && "text-down",
                        )}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
