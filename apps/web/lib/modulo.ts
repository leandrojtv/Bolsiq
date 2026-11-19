import { MODULOS, type Modulo } from "@bolsiq/ui";

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

export function lembrarModulo(m: Modulo): void {
  document.cookie = `${COOKIE_DO_MODULO}=${m}; path=/; max-age=31536000; samesite=lax`;
}
