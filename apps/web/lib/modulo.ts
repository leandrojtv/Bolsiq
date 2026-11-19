import { MODULOS, moduloDaRota, type Modulo } from "@bolsiq/ui";

/**
 * Ultimo modulo usado (ADR 0031): preferencia do aparelho, num cookie legivel
 * pelo navegador. Define a tela de entrada depois do login.
 */
export const COOKIE_DO_MODULO = "bolsiq_modulo";

export function moduloDoCookie(cookies: string): Modulo {
  const valor = cookies
    .split(";")
    .map((c) => c.trim().split("="))
    .find(([k]) => k === COOKIE_DO_MODULO)?.[1];
  return MODULOS.find((m) => m.id === valor)?.id ?? "investimentos";
}

export function entradaDoModulo(m: Modulo): string {
  return MODULOS.find((x) => x.id === m)?.href ?? "/carteiras";
}

/** Rotas de Investimentos; conta, login e configuracoes nao mudam o modulo salvo. */
const INVESTIMENTOS = ["/ativo", "/comparar", "/screener", "/carteiras", "/alertas"];

/** Modulo a lembrar ao visitar `caminho`, ou null se a rota nao e de modulo. */
export function moduloParaLembrar(caminho: string): Modulo | null {
  const m = moduloDaRota(caminho);
  if (m !== "investimentos") return m;
  return INVESTIMENTOS.some((p) => caminho === p || caminho.startsWith(`${p}/`))
    ? m
    : null;
}

export function lembrarModulo(m: Modulo): void {
  document.cookie = `${COOKIE_DO_MODULO}=${m}; path=/; max-age=31536000; samesite=lax`;
}
