"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { simularCortes, type Corte } from "@bolsiq/finance/puro";
import { Card, Money, Skeleton, StatTile, cn } from "@bolsiq/ui";
import { CAMPO } from "../conta/campos";
import { useSimulador } from "./cliente";
import { nomeDoMes } from "./Mes";

const REDUCOES = [0, 10, 20, 30, 50, 100];

export function PaginaDoSimulador() {
  const { data: base, isPending } = useSimulador();
  const [assinaturas, setAssinaturas] = useState<Set<string>>(new Set());
  const [categorias, setCategorias] = useState<Record<string, number>>({});
  const [formiga, setFormiga] = useState(0);

  const r = useMemo(() => {
    if (!base) return null;
    const cortes: Corte[] = [
      ...[...assinaturas].map((id): Corte => ({ tipo: "assinatura", id })),
      ...Object.entries(categorias)
        .filter(([, p]) => p > 0)
        .map(([category_id, reducao_pct]): Corte => ({
          tipo: "categoria",
          category_id,
          reducao_pct,
        })),
      ...(formiga > 0 ? [{ tipo: "formiga", reducao_pct: formiga } as Corte] : []),
    ];
    return simularCortes(base, cortes);
  }, [base, assinaturas, categorias, formiga]);

  const marcar = (id: string) => {
    const n = new Set(assinaturas);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setAssinaturas(n);
  };

  return (
    <div className="flex flex-col gap-5">
      <h1 className="m-0 text-[26px] font-bold tracking-tight">Simulador de cortes</h1>
      <p className="m-0 max-w-[70ch] text-sm text-text-2">
        Escolha o que cortar e veja a economia, o fluxo de caixa dos próximos 12 meses e
        quanto antes cada meta chega. Nada é alterado nos seus lançamentos.{" "}
        <Link href="/financas/insights" className="text-link hover:text-link-hover">
          Voltar aos insights
        </Link>
      </p>
      {isPending || !base || !r ? (
        <Skeleton className="h-72" />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-5">
            <Card title="Assinaturas">
              {base.assinaturas.length === 0 ? (
                <p className="m-0 text-sm text-text-3">Nenhuma assinatura detectada.</p>
              ) : (
                <ul aria-label="Assinaturas para cortar" className="m-0 list-none p-0">
                  {base.assinaturas.map((a) => (
                    <li key={a.id} className="py-1.5">
                      <label className="flex items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={assinaturas.has(a.id)}
                          onChange={() => marcar(a.id)}
                        />
                        <span className="flex-1">{a.nome}</span>
                        <Money value={a.valor_mensal} />
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Reduzir categorias (média dos últimos 3 meses)">
              {base.categorias.length === 0 ? (
                <p className="m-0 text-sm text-text-3">
                  Sem despesas nos últimos 3 meses.
                </p>
              ) : (
                <ul aria-label="Categorias para reduzir" className="m-0 list-none p-0">
                  {base.categorias.map((c) => (
                    <li
                      key={c.category_id}
                      className="flex items-center gap-3 py-1.5 text-sm"
                    >
                      <span className="flex-1">
                        {c.nome}
                        <span className="block text-xs text-text-3">
                          <Money value={c.media_mensal} /> por mês
                        </span>
                      </span>
                      <select
                        aria-label={`Reduzir ${c.nome}`}
                        className={cn(CAMPO, "w-24")}
                        value={categorias[c.category_id] ?? 0}
                        onChange={(e) =>
                          setCategorias({
                            ...categorias,
                            [c.category_id]: Number(e.target.value),
                          })
                        }
                      >
                        {REDUCOES.map((p) => (
                          <option key={p} value={p}>
                            -{p}%
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {base.formiga && (
              <Card title="Efeito formiga">
                <label className="flex items-center gap-3 text-sm">
                  <span className="flex-1">
                    Compras pequenas que viraram hábito
                    <span className="block text-xs text-text-3">
                      <Money value={base.formiga.mensal} /> por mês
                    </span>
                  </span>
                  <select
                    aria-label="Reduzir efeito formiga"
                    className={cn(CAMPO, "w-24")}
                    value={formiga}
                    onChange={(e) => setFormiga(Number(e.target.value))}
                  >
                    {REDUCOES.map((p) => (
                      <option key={p} value={p}>
                        -{p}%
                      </option>
                    ))}
                  </select>
                </label>
              </Card>
            )}
          </div>

          <div className="flex flex-col gap-5">
            <section
              aria-label="Economia simulada"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              <StatTile
                label="Economia por mês"
                value={<Money value={r.economia_mensal} className="text-up" />}
              />
              <StatTile
                label="Economia por ano"
                value={<Money value={r.economia_anual} className="text-up" />}
              />
            </section>
            {r.oportunidade && (
              <p className="m-0 rounded-control bg-surface-2 p-3 text-sm">
                Investindo a economia no CDI:{" "}
                <Money value={r.oportunidade.em_5_anos.acumulado} /> em 5 anos e{" "}
                <Money value={r.oportunidade.em_10_anos.acumulado} /> em 10 anos.
                <span className="mt-1 block text-xs text-text-3">
                  Premissa: {r.oportunidade.premissa} Fonte: {r.oportunidade.fonte}.
                </span>
              </p>
            )}
            <Card title="Metas">
              {r.metas.length === 0 ? (
                <p className="m-0 text-sm text-text-3">
                  Sem metas ativas.{" "}
                  <Link
                    href="/financas/metas"
                    className="text-link hover:text-link-hover"
                  >
                    Criar meta
                  </Link>
                </p>
              ) : (
                <ul aria-label="Metas com o corte" className="m-0 list-none p-0 text-sm">
                  {r.metas.map((m) => (
                    <li key={m.id} className="flex justify-between gap-3 py-1.5">
                      <span>{m.nome}</span>
                      <span className={cn(m.meses_antes > 0 && "font-semibold text-up")}>
                        {m.meses_base === 0
                          ? "já atingida"
                          : m.meses_antes > 0
                            ? `${m.meses_antes} ${m.meses_antes === 1 ? "mês" : "meses"} antes`
                            : `em ${m.meses_base} meses`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="m-0 text-xs text-text-3">
                Supondo que você guarde o valor mensal que cada meta pede mais a economia.
              </p>
            </Card>
            <Card title="Fluxo projetado">
              <table aria-label="Fluxo com o corte" className="w-full text-xs md:text-sm">
                <thead>
                  <tr className="text-right text-xs text-text-3">
                    <th className="py-1.5 text-left font-medium">Mês</th>
                    <th className="py-1.5 font-medium">Hoje</th>
                    <th className="py-1.5 font-medium">Com o corte</th>
                  </tr>
                </thead>
                <tbody>
                  {r.fluxo.novo.meses.map((m, i) => {
                    const antes = r.fluxo.base.meses[i]!;
                    return (
                      <tr key={m.mes} className="border-t border-border text-right">
                        <td className="py-1.5 text-left first-letter:uppercase">
                          {nomeDoMes(m.mes)}
                        </td>
                        <td className="py-1.5">
                          <Money
                            value={antes.saldo_final}
                            className={cn(
                              antes.saldo_final.startsWith("-") && "text-down",
                            )}
                          />
                        </td>
                        <td className="py-1.5">
                          <Money
                            value={m.saldo_final}
                            className={cn(
                              "font-semibold",
                              m.saldo_final.startsWith("-") && "text-down",
                            )}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
