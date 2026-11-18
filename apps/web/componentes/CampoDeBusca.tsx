"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { FundSummary } from "@bolsiq/contracts";
import { cn } from "@bolsiq/ui";
import { api, buscarAtivos, type Envelope } from "@/lib/api";

const TIPO: Record<string, string> = {
  stock: "Ação",
  fii: "FII",
  bdr: "BDR",
  etf: "ETF",
  fund: "Fundo",
};

export interface Opcao {
  id: string;
  rotulo: string;
  nome: string;
  tipo: string;
}

const INDICES: Opcao[] = [
  { id: "IBOV", rotulo: "IBOV", nome: "Ibovespa", tipo: "Índice" },
  { id: "CDI", rotulo: "CDI", nome: "CDI", tipo: "Índice" },
  { id: "IPCA", rotulo: "IPCA", nome: "IPCA", tipo: "Índice" },
];

async function opcoes(
  termo: string,
  comFundos: boolean,
  signal: AbortSignal,
): Promise<Opcao[]> {
  const [ativos, fundos] = await Promise.all([
    buscarAtivos(termo, signal),
    comFundos && termo.length >= 2
      ? api<Envelope<FundSummary[]>>(`v1/funds?q=${encodeURIComponent(termo)}`, {
          signal,
        }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const deAtivos = ativos.data.map((a) => ({
    id: a.ticker,
    rotulo: a.ticker,
    nome: a.name,
    tipo: TIPO[a.kind] ?? a.kind,
  }));
  const deFundos = (fundos?.data ?? []).slice(0, 8).map((f) => ({
    id: f.cnpj,
    rotulo: f.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5"),
    nome: f.name,
    tipo: "Fundo",
  }));
  const deIndices = comFundos
    ? INDICES.filter(
        (i) =>
          i.id.startsWith(termo.toUpperCase()) ||
          i.nome.toLowerCase().startsWith(termo.toLowerCase()),
      )
    : [];
  return [...deIndices, ...deAtivos.slice(0, 12), ...deFundos];
}

export interface CampoDeBuscaProps {
  id: string;
  rotulo: string;
  placeholder: string;
  onEscolher: (opcao: Opcao) => void;
  /** Inclui fundos da CVM e indices (comparador). */
  amplo?: boolean;
  atalho?: boolean;
  autoFocus?: boolean;
  className?: string;
}

/**
 * Campo com autocomplete (combobox do WAI-ARIA): setas navegam, Enter
 * escolhe, Esc fecha. A busca global e o comparador usam este campo.
 */
export function CampoDeBusca({
  id,
  rotulo,
  placeholder,
  onEscolher,
  amplo = false,
  atalho = false,
  autoFocus = false,
  className,
}: CampoDeBuscaProps) {
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
    queryKey: ["busca", atraso, amplo],
    queryFn: ({ signal }) => opcoes(atraso, amplo, signal),
    enabled: atraso.length >= 1,
    staleTime: 300_000,
  });
  const itens = atraso.length >= 1 ? (data ?? []) : [];

  const escolher = (o: Opcao) => {
    setAberta(false);
    setTermo("");
    onEscolher(o);
  };

  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <div className="flex h-touch items-center gap-2.5 rounded-control border border-border-input bg-surface px-3.5">
        <Search aria-hidden="true" size={16} className="shrink-0 text-benchmark" />
        <input
          id={id}
          type="search"
          role="combobox"
          aria-label={rotulo}
          aria-expanded={aberta && itens.length > 0}
          aria-controls={lista}
          aria-autocomplete="list"
          aria-activedescendant={aberta && itens[ativo] ? `${lista}-${ativo}` : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder={placeholder}
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
                itens[ativo] ??
                (/^[A-Za-z0-9]{4,12}$/.test(termo)
                  ? {
                      id: termo.toUpperCase(),
                      rotulo: termo.toUpperCase(),
                      nome: "",
                      tipo: "",
                    }
                  : null);
              if (alvo) {
                e.preventDefault();
                escolher(alvo);
              }
            } else if (e.key === "Escape") {
              setAberta(false);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-3"
        />
        {atalho && (
          <kbd className="hidden rounded-chip border border-border-strong px-1.5 py-0.5 font-mono text-xs text-text-3 sm:inline">
            Ctrl K
          </kbd>
        )}
      </div>
      {aberta && itens.length > 0 && (
        <ul
          id={lista}
          role="listbox"
          aria-label="Resultados da busca"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-96 overflow-auto rounded-control border border-border-strong bg-surface p-1"
        >
          {itens.map((o, i) => (
            <li
              key={o.id}
              id={`${lista}-${i}`}
              role="option"
              aria-selected={i === ativo}
              onMouseDown={(e) => {
                e.preventDefault();
                escolher(o);
              }}
              onMouseEnter={() => setAtivo(i)}
              className={cn(
                "flex min-h-touch cursor-pointer items-center gap-3 rounded-item px-3",
                i === ativo && "bg-surface-2",
              )}
            >
              <span className="w-16 shrink-0 truncate font-mono font-semibold">
                {o.rotulo}
              </span>
              <span className="min-w-0 flex-1 truncate text-text-2">{o.nome}</span>
              <span className="rounded-chip bg-surface-2 px-2 py-0.5 text-xs text-text-2">
                {o.tipo}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
