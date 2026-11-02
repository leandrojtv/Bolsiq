"use client";

import { useEffect, useState } from "react";

export interface CotacaoAoVivo {
  ticker: string;
  price: string;
  change: string;
  ts: string;
}

/**
 * Cotacao pelo /api/stream (SSE), so com a aba visivel. Aba escondida fecha a
 * conexao: celular com o app em segundo plano nao fica com socket aberto.
 */
export function useCotacaoAoVivo(ticker: string): CotacaoAoVivo | null {
  const [ultima, setUltima] = useState<CotacaoAoVivo | null>(null);

  useEffect(() => {
    let fonte: EventSource | null = null;
    const abrir = () => {
      if (fonte || document.visibilityState !== "visible") return;
      fonte = new EventSource(`/api/stream?t=${ticker}`);
      fonte.onmessage = (e: MessageEvent<string>) => {
        const m = JSON.parse(e.data) as CotacaoAoVivo & { type: string };
        if (m.type === "quote" && m.ticker === ticker) setUltima(m);
      };
    };
    const fechar = () => {
      fonte?.close();
      fonte = null;
    };
    const aoMudar = () => (document.visibilityState === "visible" ? abrir() : fechar());
    abrir();
    document.addEventListener("visibilitychange", aoMudar);
    return () => {
      document.removeEventListener("visibilitychange", aoMudar);
      fechar();
    };
  }, [ticker]);

  return ultima;
}
