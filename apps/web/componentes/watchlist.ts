"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Watchlist no localStorage, por enquanto. No Prompt E migra para o banco,
 * por usuario; a interface (lista, alternar) fica a mesma.
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

export function useWatchlist() {
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
