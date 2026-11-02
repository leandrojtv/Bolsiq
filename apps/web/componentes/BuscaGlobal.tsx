"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { cn } from "@bolsiq/ui";
import { buscarAtivos } from "@/lib/api";

export const ID_DA_BUSCA = "busca-global";

const TIPO: Record<string, string> = {
  stock: "Ação",
  fii: "FII",
  bdr: "BDR",
  etf: "ETF",
  fund: "Fundo",
};

/**
 * Busca global com autocomplete (padrao combobox do WAI-ARIA): setas
 * navegam, Enter abre, Esc fecha. Ctrl+K foca pelo AppShell.
 */
export function BuscaGlobal() {
  const router = useRouter();
  const lista = useId();
  const [termo, setTermo] = useState("");
  const [atraso, setAtraso] = useState("");
  const [aberta, setAberta] = useState(false);
  const [ativo, setAtivo] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setAtraso(termo.trim()), 150);
    return () => clearTimeout(t);
  }, [termo]);

  const { data } = useQuery({
    queryKey: ["busca", atraso],
    queryFn: ({ signal }) => buscarAtivos(atraso, signal),
    enabled: atraso.length >= 1,
    staleTime: 300_000,
  });
  const itens = atraso.length >= 1 ? (data?.data ?? []) : [];

  const ir = (ticker: string) => {
    setAberta(false);
    setTermo("");
    router.push(`/ativo/${ticker}`);
  };

  return (
    <div className="relative min-w-0 flex-1">
      <div className="flex h-touch items-center gap-2.5 rounded-control border border-border-input bg-surface px-3.5">
        <Search aria-hidden="true" size={16} className="shrink-0 text-benchmark" />
        <input
          id={ID_DA_BUSCA}
          type="search"
          role="combobox"
          aria-label="Buscar ativo"
          aria-expanded={aberta && itens.length > 0}
          aria-controls={lista}
          aria-autocomplete="list"
          aria-activedescendant={aberta && itens[ativo] ? `${lista}-${ativo}` : undefined}
          autoComplete="off"
          placeholder="Buscar ação, FII, BDR, ETF ou fundo"
          value={termo}
          onChange={(e) => {
            setTermo(e.target.value);
            setAberta(true);
            setAtivo(0);
          }}
          onFocus={() => setAberta(true)}
          onBlur={() => setTimeout(() => setAberta(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setAtivo((i) => Math.min(i + 1, itens.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAtivo((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              const alvo =
                itens[ativo]?.ticker ??
                (/^[A-Za-z0-9]{4,12}$/.test(termo) ? termo.toUpperCase() : null);
              if (alvo) {
                e.preventDefault();
                ir(alvo);
              }
            } else if (e.key === "Escape") {
              setAberta(false);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-3"
        />
        <kbd className="hidden rounded-chip border border-border-strong px-1.5 py-0.5 font-mono text-xs text-text-3 sm:inline">
          Ctrl K
        </kbd>
      </div>
      {aberta && itens.length > 0 && (
        <ul
          id={lista}
          role="listbox"
          aria-label="Ativos encontrados"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-96 overflow-auto rounded-control border border-border-strong bg-surface p-1"
        >
          {itens.map((a, i) => (
            <li
              key={a.ticker}
              id={`${lista}-${i}`}
              role="option"
              aria-selected={i === ativo}
              onMouseDown={(e) => {
                e.preventDefault();
                ir(a.ticker);
              }}
              onMouseEnter={() => setAtivo(i)}
              className={cn(
                "flex min-h-touch cursor-pointer items-center gap-3 rounded-item px-3",
                i === ativo && "bg-surface-2",
              )}
            >
              <span className="w-16 font-mono font-semibold">{a.ticker}</span>
              <span className="min-w-0 flex-1 truncate text-text-2">{a.name}</span>
              <span className="rounded-chip bg-surface-2 px-2 py-0.5 text-xs text-text-2">
                {TIPO[a.kind] ?? a.kind}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
