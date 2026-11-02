"use client";

import { useRouter } from "next/navigation";
import { CampoDeBusca } from "./CampoDeBusca";

export const ID_DA_BUSCA = "busca-global";

/** Busca global do topo: escolher um ativo abre a pagina dele. Ctrl+K foca. */
export function BuscaGlobal() {
  const router = useRouter();
  return (
    <CampoDeBusca
      id={ID_DA_BUSCA}
      rotulo="Buscar ativo"
      placeholder="Buscar ação, FII, BDR, ETF ou fundo"
      atalho
      onEscolher={(o) => router.push(`/ativo/${o.id}`)}
    />
  );
}
