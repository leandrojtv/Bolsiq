"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Landmark } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, EmptyState, Money, Skeleton, StatTile, cn } from "@bolsiq/ui";
import { hojeEmSp } from "@/lib/indicadores-tecnicos";
import { dataBr } from "./Cartoes";
import { CHAVE, editarLancamento, useContas, usePainel } from "./cliente";
import { GraficoDeCategorias } from "./GraficoDeCategorias";
import { LancamentoRapido } from "./Lancamentos";
import { SeletorDeMes } from "./Mes";

const pct = (v: number | null) =>
  v === null ? "sem renda no mês" : `${v.toLocaleString("pt-BR")}% da renda`;

/**
 * Dashboard do mes. Despesas sao compras e contas; o pagamento da fatura e
 * transferencia e nao entra (o gasto ja contou na compra).
 */
export function VisaoGeral() {
  const cliente = useQueryClient();
  const { data: contas, isPending } = useContas();
  const [mes, setMes] = useState(hojeEmSp().slice(0, 7));
  const { data: painel } = usePainel(mes);
  const [erro, setErro] = useState<string | null>(null);
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

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[26px] font-bold tracking-tight">Visão geral</h1>
        <SeletorDeMes mes={mes} onMudar={setMes} />
      </header>

      <LancamentoRapido contas={contas} onSalvo={atualizar} />

      {!painel ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <section
            aria-label="Números do mês"
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            <StatTile
              label="Renda recebida"
              value={<Money value={painel.renda.recebida} className="text-up" />}
              subtitle={
                <>
                  de <Money value={painel.renda.prevista} /> prevista
                </>
              }
            />
            <StatTile
              label="Despesas pagas"
              value={<Money value={painel.despesas.pagas} className="text-down" />}
              subtitle={
                <>
                  a pagar <Money value={painel.despesas.a_pagar} />
                </>
              }
            />
            <StatTile
              label="Saldo previsto no fim do mês"
              value={
                <Money
                  value={painel.saldo_previsto_fim_do_mes}
                  className={cn(
                    painel.saldo_previsto_fim_do_mes.startsWith("-") && "text-down",
                  )}
                />
              }
              subtitle="contas, com o que está previsto"
            />
          </section>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card title="Fixos x variáveis">
              <ul
                aria-label="Fixos e variáveis"
                className="m-0 flex list-none flex-col gap-3 p-0"
              >
                {(
                  [
                    ["Despesas fixas", painel.fixos],
                    ["Despesas variáveis", painel.variaveis],
                  ] as const
                ).map(([rotulo, v]) => (
                  <li key={rotulo} className="flex items-baseline justify-between gap-3">
                    <span>
                      {rotulo}
                      <span className="block text-xs text-text-3">
                        {pct(v.percentual_da_renda)}
                      </span>
                    </span>
                    <Money value={v.valor} className="font-semibold" />
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Maiores categorias do mês">
              {painel.top_categorias.length === 0 ? (
                <p className="m-0 text-sm text-text-3">Nenhuma despesa neste mês.</p>
              ) : (
                <GraficoDeCategorias categorias={painel.top_categorias} />
              )}
            </Card>
          </div>

          <Card title="A pagar nos próximos 7 dias">
            {erro && (
              <p role="alert" className="m-0 text-sm text-down">
                {erro}
              </p>
            )}
            {painel.a_pagar.length === 0 ? (
              <p className="m-0 text-sm text-text-3">
                Nada previsto para os próximos dias.
              </p>
            ) : (
              <ul aria-label="A pagar" className="m-0 list-none p-0">
                {painel.a_pagar.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center gap-3 border-b border-border py-2.5 last:border-0"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span>{l.descricao}</span>
                      <span
                        className={cn(
                          "text-xs",
                          l.atrasado ? "text-down" : "text-text-3",
                        )}
                      >
                        {l.atrasado ? "atrasado · " : ""}
                        {dataBr(l.data)} · {l.conta}
                      </span>
                    </span>
                    <Money value={l.valor} className="font-semibold" />
                    <Button
                      variant="ghost"
                      className="px-2"
                      aria-label={`Marcar ${l.descricao} como pago`}
                      onClick={() => {
                        setErro(null);
                        editarLancamento(l.id, { status: "realizado" })
                          .then(atualizar)
                          .catch((f: Error) => setErro(f.message));
                      }}
                    >
                      <Check aria-hidden="true" size={16} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
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
                {painel.contas.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between border-b border-border py-2.5 last:border-0"
                  >
                    <span>{c.nome}</span>
                    <Money
                      value={c.saldo}
                      className={cn(
                        "font-semibold",
                        c.saldo.startsWith("-") && "text-down",
                      )}
                    />
                  </li>
                ))}
              </ul>
            </Card>
            <Card
              title="Faturas abertas"
              action={
                <Link
                  href="/financas/cartoes"
                  className="text-sm text-link hover:text-link-hover"
                >
                  Cartões
                </Link>
              }
            >
              {painel.faturas_abertas.length === 0 ? (
                <p className="m-0 text-sm text-text-3">Nenhuma fatura em aberto.</p>
              ) : (
                <ul aria-label="Faturas abertas" className="m-0 list-none p-0">
                  {painel.faturas_abertas.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0"
                    >
                      <Link
                        href={`/financas/cartoes/${f.card_id}/faturas/${f.id}`}
                        className="flex flex-col text-text"
                      >
                        <span>{f.cartao}</span>
                        <span className="text-xs text-text-3">
                          vence {dataBr(f.vencimento)} ·{" "}
                          {f.status === "aberta" ? "aberta" : "fechada"}
                        </span>
                      </Link>
                      <Money value={f.total} className="font-semibold" />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      <nav aria-label="Atalhos" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {[
          ["/financas/lancamentos", "Ver todos os lançamentos"],
          ["/financas/planejamento", "Planejamento do mês"],
          ["/financas/recorrentes", "Recorrentes"],
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
