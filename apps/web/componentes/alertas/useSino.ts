"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { CHAVES } from "./cliente";

/**
 * Contador do sino. O SSE abre com o total e manda um evento a cada
 * notificacao nova; o EventSource reconecta sozinho se o servidor cair.
 */
export function useSino(): number {
  const cliente = useQueryClient();
  const { data } = useQuery<number>({
    queryKey: CHAVES.naoLidas,
    queryFn: () => cliente.getQueryData<number>(CHAVES.naoLidas) ?? 0,
    staleTime: Infinity,
  });

  useEffect(() => {
    const fonte = new EventSource("/api/notificacoes/stream");
    const contar = (e: MessageEvent) => {
      const { nao_lidas } = JSON.parse(String(e.data)) as { nao_lidas: number };
      cliente.setQueryData(CHAVES.naoLidas, nao_lidas);
    };
    fonte.addEventListener("contador", contar);
    fonte.addEventListener("notificacao", (e) => {
      contar(e);
      void cliente.invalidateQueries({ queryKey: CHAVES.notificacoes });
    });
    return () => fonte.close();
  }, [cliente]);

  return data ?? 0;
}
