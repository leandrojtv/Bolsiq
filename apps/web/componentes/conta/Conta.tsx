"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { api } from "@/lib/api";
import { authCliente } from "@/lib/auth-cliente";

export interface Conta {
  uid: string | null;
  nome: string | null;
}

const ContaContexto = createContext<Conta>({ uid: null, nome: null });
export const useConta = () => useContext(ContaContexto);

const VINCULADO = "bolsiq:vinculado";
const WATCHLIST_LOCAL = "bolsiq:watchlist";

function lerLocal(chave: string): string | null {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}

/**
 * Sessao do Better Auth para os componentes, e o vinculo do aparelho no
 * primeiro login (ADR 0022): manda a watchlist do localStorage e o servidor
 * passa os alertas do id provisorio para a conta. Uma vez por conta e aparelho.
 */
export function ProvedorDeConta({ children }: { children: ReactNode }) {
  const { data } = authCliente.useSession();
  const uid = data?.user.id ?? null;
  const cliente = useQueryClient();

  useEffect(() => {
    if (!uid || lerLocal(VINCULADO) === uid) return;
    let local: unknown = [];
    try {
      local = JSON.parse(lerLocal(WATCHLIST_LOCAL) ?? "[]");
    } catch {
      local = [];
    }
    void api<{ data: { watchlist: string[] } }>("conta/vincular", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ watchlist: Array.isArray(local) ? local : [] }),
    }).then((r) => {
      cliente.setQueryData(["watchlist", uid], r.data.watchlist);
      void cliente.invalidateQueries({ queryKey: ["alertas"] });
      try {
        localStorage.setItem(VINCULADO, uid);
      } catch {
        // Sem storage: vincula de novo no proximo carregamento, sem efeito colateral.
      }
    });
  }, [uid, cliente]);

  return (
    <ContaContexto.Provider value={{ uid, nome: data?.user.name ?? null }}>
      {children}
    </ContaContexto.Provider>
  );
}
