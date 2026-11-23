import type { ToolSet } from "ai";
import {
  criarFerramentas,
  type Fontes,
  type OpcoesDasFerramentas,
} from "./ferramentas.js";
import { criarFerramentasFinanceiras } from "./financas/ferramentas.js";
import type { FontesFinanceiras } from "./financas/tipos.js";
import type { ModuloDoAssistente } from "./prompt.js";

/**
 * Ferramentas por modulo da conversa (ADR 0036): Investimentos como antes, o
 * Bolsiq Financas so com as financeiras (capacidade_aporte incluida) e o Painel
 * geral com as duas listas.
 */
export function ferramentasDoModulo(
  modulo: ModuloDoAssistente,
  o: { fontes: Fontes; financas: FontesFinanceiras; opcoes: OpcoesDasFerramentas },
): ToolSet {
  const financeiras = () =>
    criarFerramentasFinanceiras(o.financas, { hoje: o.opcoes.hoje });
  if (modulo === "financas") return financeiras();
  const investimentos = criarFerramentas(o.fontes, o.opcoes);
  return modulo === "painel" ? { ...investimentos, ...financeiras() } : investimentos;
}

/** Modulo do caminho da tela, como o AppShell decide (`moduloDaRota`). */
export function moduloDoCaminho(caminho: string | undefined): ModuloDoAssistente {
  if (!caminho) return "investimentos";
  if (caminho === "/financas" || caminho.startsWith("/financas/")) return "financas";
  if (caminho === "/painel" || caminho.startsWith("/painel/")) return "painel";
  return "investimentos";
}
