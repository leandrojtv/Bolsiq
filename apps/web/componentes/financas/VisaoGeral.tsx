"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Landmark } from "lucide-react";
import Link from "next/link";
import { Button, Card, EmptyState, Money, Skeleton, StatTile, cn } from "@bolsiq/ui";
import { CHAVE, useContas, useResumo } from "./cliente";
import { LancamentoRapido } from "./Lancamentos";

/**
 * Entrada do Bolsiq Financas. Sem conta, guia para criar a primeira; com conta,
 * o mes corrente em numeros e o lancamento rapido. O dashboard completo do mes
 * vem numa etapa seguinte.
 */
export function VisaoGeral() {
  const cliente = useQueryClient();
  const { data: contas, isPending } = useContas();
  const { data: resumo } = useResumo();
  const atualizar = () => void cliente.invalidateQueries({ queryKey: CHAVE });

  if (isPending) return <Skeleton className="h-64" />;

  if (!contas?.length)
    return (
      <div className="flex flex-col gap-5">
        <h1 className="m-0 text-[26px] font-bold tracking-tight">Bolsiq Finanças</h1>
        <Card>
          <EmptyState
            icon={<Landmark aria-hidden="true" size={28} />}
            title="Comece pela sua primeira conta"
            description="Cadastre a conta do banco, a carteira ou o vale-refeição com o saldo de hoje. Depois é só lançar receitas e despesas."
            action={
              <Button asChild variant="primary">
                <Link href="/financas/contas?nova=1">Criar primeira conta</Link>
              </Button>
            }
          />
        </Card>
      </div>
    );

  const mes = resumo
    ? new Intl.DateTimeFormat("pt-BR", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${resumo.competencia}T00:00:00Z`))
    : "";

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="m-0 text-[26px] font-bold tracking-tight">Visão geral</h1>
        <span className="text-sm text-text-3 first-letter:uppercase">{mes}</span>
      </header>

      <LancamentoRapido contas={contas} onSalvo={atualizar} />

      {resumo && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile
            label="Receitas do mês"
            value={<Money value={resumo.receita.realizado} className="text-up" />}
            subtitle={
              <>
                previsto <Money value={resumo.receita.previsto} />
              </>
            }
          />
          <StatTile
            label="Despesas do mês"
            value={<Money value={resumo.despesa.realizado} className="text-down" />}
            subtitle={
              <>
                previsto <Money value={resumo.despesa.previsto} />
              </>
            }
          />
          <StatTile
            label="Resultado"
            value={
              <Money
                value={resumo.resultado}
                className={resumo.resultado.startsWith("-") ? "text-down" : "text-up"}
              />
            }
            subtitle="receitas menos despesas, previstas e realizadas"
          />
        </div>
      )}

      <Card
        title="Saldo por conta"
        action={
          <Link
            href="/financas/contas"
            className="text-sm text-link hover:text-link-hover"
          >
            Gerenciar
          </Link>
        }
      >
        <ul aria-label="Saldo por conta" className="m-0 list-none p-0">
          {(resumo?.contas ?? []).map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between border-b border-border py-2.5 last:border-0"
            >
              <span>{c.nome}</span>
              <Money
                value={c.saldo}
                className={cn("font-semibold", c.saldo.startsWith("-") && "text-down")}
              />
            </li>
          ))}
        </ul>
      </Card>
      <nav aria-label="Atalhos" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {[
          ["/financas/lancamentos", "Ver todos os lançamentos"],
          ["/financas/importar", "Importar extrato ou fatura"],
          ["/financas/categorias", "Categorias"],
          ["/financas/regras", "Regras de categorização"],
        ].map(([href, rotulo]) => (
          <Link
            key={href}
            href={href as string}
            className="text-link hover:text-link-hover"
          >
            {rotulo}
          </Link>
        ))}
      </nav>
    </div>
  );
}
