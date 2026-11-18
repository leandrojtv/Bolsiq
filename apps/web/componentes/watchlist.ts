"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { useConta } from "./conta/Conta";

/**
 * Watchlist: no banco com login, no localStorage sem. No primeiro login a do
 * localStorage vai para a conta (ProvedorDeConta). A interface e a mesma.
 */
const CHAVE = "bolsiq:watchlist";
const PADRAO = ["PETR4", "VALE3", "ITUB4"];
const EVENTO = "bolsiq:watchlist";

function ler(): string[] {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (bruto === null) return PADRAO;
    const lista = JSON.parse(bruto) as unknown;
    return Array.isArray(lista)
      ? lista.filter((t): t is string => typeof t === "string")
      : PADRAO;
  } catch {
    return PADRAO;
  }
}

let cache: string[] | null = null;
function instantaneo(): string[] {
  cache ??= ler();
  return cache;
}

function assinar(aviso: () => void): () => void {
  const aoMudar = () => {
    cache = null;
    aviso();
  };
  window.addEventListener(EVENTO, aoMudar);
  window.addEventListener("storage", aoMudar);
  return () => {
    window.removeEventListener(EVENTO, aoMudar);
    window.removeEventListener("storage", aoMudar);
  };
}

function useWatchlistLocal() {
  const lista = useSyncExternalStore(assinar, instantaneo, () => PADRAO);
  const alternar = useCallback((ticker: string) => {
    const atual = ler();
    const nova = atual.includes(ticker)
      ? atual.filter((t) => t !== ticker)
      : [...atual, ticker];
    try {
      localStorage.setItem(CHAVE, JSON.stringify(nova));
    } catch {
      // Modo privado sem storage: a watchlist so dura a sessao.
    }
    window.dispatchEvent(new Event(EVENTO));
  }, []);
  return { lista, alternar, contem: (t: string) => lista.includes(t) };
}

function useWatchlistDaConta(uid: string | null) {
  const cliente = useQueryClient();
  const chave = ["watchlist", uid];
  const { data } = useQuery({
    queryKey: chave,
    queryFn: () => api<{ data: string[] }>("watchlist").then((r) => r.data),
    enabled: uid !== null,
  });
  const salvar = useMutation({
    mutationFn: (tickers: string[]) =>
      api<{ data: string[] }>("watchlist", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tickers }),
      }),
    onMutate: (tickers) => cliente.setQueryData(chave, tickers),
    onSuccess: (r) => cliente.setQueryData(chave, r.data),
  });
  const lista = data ?? [];
  return {
    lista,
    alternar: (ticker: string) =>
      salvar.mutate(
        lista.includes(ticker) ? lista.filter((t) => t !== ticker) : [...lista, ticker],
      ),
    contem: (t: string) => lista.includes(t),
  };
}

export function useWatchlist() {
  const { uid } = useConta();
  const local = useWatchlistLocal();
  const conta = useWatchlistDaConta(uid);
  return uid ? conta : local;
}
