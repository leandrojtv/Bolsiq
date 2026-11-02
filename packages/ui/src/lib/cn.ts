import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Junta classes e resolve conflito do Tailwind (a ultima vence). */
export function cn(...entradas: ClassValue[]): string {
  return twMerge(clsx(entradas));
}
