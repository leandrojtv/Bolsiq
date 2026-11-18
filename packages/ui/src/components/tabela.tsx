"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "../lib/cn.js";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (linha: T) => ReactNode;
  /** Valor para ordenar. Sem ele, a coluna nao ordena. Nulo vai sempre para o fim. */
  sortValue?: (linha: T) => number | string | null;
  align?: "left" | "right";
  /** Numero: fonte mono e alinhado a direita. */
  numeric?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (linha: T) => string;
  /** Legenda da tabela, para leitor de tela. */
  caption: string;
  /** Fixa a primeira coluna na rolagem horizontal. Padrao: true. */
  stickyFirstColumn?: boolean;
  initialSort?: { key: string; direction: "asc" | "desc" };
  /**
   * Ordenacao controlada: com `sort` e `onSortChange`, a tabela nao reordena
   * as linhas; so mostra a ordem e avisa o clique. Para ordenacao no servidor.
   */
  sort?: { key: string; direction: "asc" | "desc" };
  onSortChange?: (sort: { key: string; direction: "asc" | "desc" }) => void;
  /** Largura minima: abaixo dela a tabela rola na horizontal. */
  minWidth?: number;
  empty?: ReactNode;
  className?: string;
}

type Ordem = { key: string; direction: "asc" | "desc" } | null;

export function ordenar<T>(linhas: T[], colunas: Column<T>[], ordem: Ordem): T[] {
  if (!ordem) return linhas;
  const coluna = colunas.find((c) => c.key === ordem.key);
  const valor = coluna?.sortValue;
  if (!valor) return linhas;
  const fator = ordem.direction === "asc" ? 1 : -1;
  return [...linhas].sort((a, b) => {
    const va = valor(a);
    const vb = valor(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va < vb) return -1 * fator;
    if (va > vb) return 1 * fator;
    return 0;
  });
}

/**
 * Tabela com ordenacao por coluna, primeira coluna fixa e rolagem horizontal.
 *
 * Em tela estreita a tabela mantem a largura minima e o container rola; o
 * ticker fica visivel na coluna fixa. `aria-sort` no cabecalho diz ao leitor
 * de tela qual coluna ordena.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  stickyFirstColumn = true,
  initialSort,
  sort,
  onSortChange,
  minWidth = 640,
  empty,
  className,
}: DataTableProps<T>) {
  const [interna, setInterna] = useState<Ordem>(initialSort ?? null);
  const controlada = sort !== undefined && onSortChange !== undefined;
  const ordem: Ordem = controlada ? sort : interna;
  const linhas = useMemo(
    () => (controlada ? rows : ordenar(rows, columns, ordem)),
    [rows, columns, ordem, controlada],
  );

  const alternar = (key: string) => {
    const proxima: { key: string; direction: "asc" | "desc" } =
      ordem?.key === key
        ? { key, direction: ordem.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "desc" };
    if (controlada) onSortChange(proxima);
    else setInterna(proxima);
  };

  const fixa = (i: number) =>
    stickyFirstColumn && i === 0 && "sticky left-0 z-10 bg-surface";

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[13px]" style={{ minWidth }}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-text-3">
            {columns.map((c, i) => {
              const direita = c.align === "right" || (c.numeric && c.align !== "left");
              const ativa = ordem?.key === c.key;
              const ariaSort = ativa
                ? ordem.direction === "asc"
                  ? "ascending"
                  : "descending"
                : undefined;
              return (
                <th
                  key={c.key}
                  scope="col"
                  {...(ariaSort ? { "aria-sort": ariaSort } : {})}
                  className={cn(
                    "p-2 font-medium",
                    direita ? "text-right" : "text-left",
                    fixa(i),
                  )}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      onClick={() => alternar(c.key)}
                      className={cn(
                        "inline-flex min-h-touch items-center gap-1 font-medium hover:text-text",
                        direita && "flex-row-reverse",
                        ativa && "text-text",
                      )}
                    >
                      {c.header}
                      {ativa ? (
                        ordem.direction === "asc" ? (
                          <ArrowUp aria-hidden="true" size={12} />
                        ) : (
                          <ArrowDown aria-hidden="true" size={12} />
                        )
                      ) : (
                        <ArrowUpDown
                          aria-hidden="true"
                          size={12}
                          className="opacity-50"
                        />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {linhas.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="p-6 text-center text-text-3">
                {empty ?? "Nenhum resultado"}
              </td>
            </tr>
          ) : (
            linhas.map((linha) => (
              <tr key={rowKey(linha)} className="border-t border-border">
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-2 py-2.5",
                      (c.align === "right" || (c.numeric && c.align !== "left")) &&
                        "text-right",
                      c.numeric && "font-mono whitespace-nowrap tabular-nums",
                      fixa(i),
                    )}
                  >
                    {c.cell(linha)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
