"use client";

import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import Link from "next/link";
import type { PainelGeral as Dados } from "@bolsiq/finance/puro";
import { Button, Card, Money, Skeleton, StatTile, cn } from "@bolsiq/ui";
import { api } from "@/lib/api";
import { abrirAssistente } from "../assistente/abrir";
import { GraficoDoPatrimonio } from "../financas/Graficos";
import { Barra } from "../financas/Mes";

const pct = (v: number) => `${v.toLocaleString("pt-BR")}%`;
const mesExtenso = (m: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${m}-01T00:00:00Z`));

const usePainelGeral = () =>
  useQuery({
    queryKey: ["painel-geral"],
    queryFn: () => api<{ data: Dados }>("financas/painel-geral").then((r) => r.data),
  });

/**
 * /painel (ADR 0037): Investimentos e Financas juntos. Todo numero vem do BFF,
 * que pede cada parte ao modulo dono; aqui so se mostra.
 */
export function PainelGeral() {
  const { data, isPending, error } = usePainelGeral();

  if (error)
    return (
      <p role="alert" className="m-0 text-down">
        Não deu para montar o painel agora. Tente de novo em instantes.
      </p>
    );
  if (isPending || !data) return <Skeleton className="h-96" />;

  const p = data.patrimonio;
  const m = data.mes;
  const c = data.capacidade;
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[26px] font-bold tracking-tight">Painel geral</h1>
        <Button
          variant="secondary"
          onClick={() => abrirAssistente("Quanto posso investir este mês e onde?")}
        >
          <MessageCircle aria-hidden="true" size={16} />
          Perguntar ao Bolsiq
        </Button>
      </header>

      <section
        aria-label="Patrimônio líquido"
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        <StatTile
          label="Patrimônio líquido"
          value={
            <Money
              value={p.patrimonio_liquido}
              className={cn(
                "text-2xl",
                p.patrimonio_liquido.startsWith("-") && "text-down",
              )}
            />
          }
          subtitle="contas + carteiras - faturas - dívidas"
        />
        <StatTile
          label="Ativos"
          value={<Money value={p.ativos} />}
          subtitle="contas e investimentos"
        />
        <StatTile
          label="Dívidas"
          value={
            <Money
              value={p.passivos}
              className={cn(Number(p.passivos) > 0 && "text-down")}
            />
          }
          subtitle={
            <>
              faturas <Money value={p.faturas} /> · empréstimos{" "}
              <Money value={p.dividas} />
            </>
          }
        />
      </section>
      {data.sem_cotacao.length > 0 && (
        <p className="m-0 text-[13px] text-text-3">
          Sem cotação agora, fora da soma: {data.sem_cotacao.join(", ")}.
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Composição">
          <ul
            aria-label="Composição do patrimônio"
            className="m-0 flex list-none flex-col gap-2.5 p-0"
          >
            {p.composicao.map((f) => (
              <li key={f.fatia} className="flex flex-col gap-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span>{f.rotulo}</span>
                  <span className="flex items-baseline gap-2">
                    {f.percentual !== null && (
                      <span className="text-xs text-text-3">{pct(f.percentual)}</span>
                    )}
                    <Money
                      value={f.valor}
                      className={cn(
                        "font-semibold",
                        f.valor.startsWith("-") && "text-down",
                      )}
                    />
                  </span>
                </span>
                {f.percentual !== null && (
                  <Barra
                    valor={Math.max(0, f.percentual)}
                    total={100}
                    rotulo={`${f.rotulo}: ${pct(f.percentual)} dos ativos`}
                  />
                )}
              </li>
            ))}
          </ul>
          {p.carteiras.length > 0 && (
            <p className="m-0 text-[13px] text-text-2">
              Carteiras:{" "}
              {p.carteiras.map((k, i) => (
                <span key={k.id}>
                  {i > 0 && " · "}
                  <Link href={`/carteiras/${k.id}`}>{k.nome}</Link>{" "}
                  {k.valor === null ? "sem cotação" : <Money value={k.valor} />}
                </span>
              ))}
            </p>
          )}
        </Card>
        <Card title="Evolução mensal">
          <GraficoDoPatrimonio pontos={data.evolucao} />
          <p className="m-0 text-[13px] text-text-3">
            Uma foto por mês, tirada no dia 1. O último ponto é o mês atual, ao vivo.
          </p>
        </Card>
      </div>

      <section aria-label="Mês atual" className="flex flex-col gap-3">
        <h2 className="m-0 text-lg font-semibold first-letter:uppercase">
          {mesExtenso(m.competencia)}
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Renda" value={<Money value={m.renda} className="text-up" />} />
          <StatTile
            label="Gastos"
            value={<Money value={m.despesas} className="text-down" />}
          />
          <StatTile
            label="Taxa de poupança"
            value={
              m.taxa_de_poupanca === null ? (
                "sem renda"
              ) : (
                <span className={cn(m.taxa_de_poupanca < 0 && "text-down")}>
                  {pct(m.taxa_de_poupanca)}
                </span>
              )
            }
            subtitle="(renda - gastos) / renda"
          />
          <StatTile
            label="Investido"
            value={<Money value={m.investido} />}
            subtitle="aportes do mês"
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Quanto posso aportar este mês">
          {c === null ? (
            <p className="m-0 text-sm text-text-3">
              Ainda sem histórico: lance receitas e despesas de alguns meses no Finanças.
            </p>
          ) : (
            <>
              <Money
                value={c.capacidade_mensal}
                className="text-2xl font-semibold"
                aria-label="Capacidade de aporte"
              />
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-text-2">
                <li>
                  Sobra média de {c.meses_de_referencia.length} meses:{" "}
                  <Money value={c.sobra_media} />
                </li>
                <li>
                  Aumento das parcelas que vêm: <Money value={c.aumento_das_parcelas} />
                </li>
                <li>
                  Para a reserva de emergência: <Money value={c.separar_para_reserva} />
                </li>
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  disabled={Number(c.capacidade_mensal) <= 0}
                  onClick={() =>
                    abrirAssistente(
                      `Onde aportar R$ ${Number(c.capacidade_mensal).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} este mês?`,
                    )
                  }
                >
                  Ver sugestão de aporte
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/financas/fluxo">Fluxo de caixa</Link>
                </Button>
              </div>
            </>
          )}
        </Card>
        <Card title="Metas">
          {data.metas.length === 0 ? (
            <p className="m-0 text-sm text-text-3">
              Nenhuma meta ativa. <Link href="/financas/metas">Criar uma meta</Link>
            </p>
          ) : (
            <ul aria-label="Metas" className="m-0 flex list-none flex-col gap-3 p-0">
              {data.metas.map((g) => (
                <li key={g.id} className="flex flex-col gap-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span>
                      {g.nome}
                      {g.fonte === "carteira" && (
                        <span className="ml-1 text-xs text-text-3">(carteira)</span>
                      )}
                    </span>
                    <span className="text-sm">
                      <Money value={g.valor_atual} className="font-semibold" /> de{" "}
                      <Money value={g.valor_alvo} />
                    </span>
                  </span>
                  <Barra
                    valor={Number(g.valor_atual)}
                    total={Number(g.valor_alvo)}
                    rotulo={`Progresso de ${g.nome}: ${pct(g.progresso)}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
