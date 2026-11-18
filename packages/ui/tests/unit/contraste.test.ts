import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contraste minimo de 4,5:1 (WCAG AA, texto normal) entre os pares que as
 * telas usam. Le os valores de tokens.css: mudar uma cor que quebra o
 * contraste reprova aqui, antes de chegar a tela.
 */
const css = readFileSync(resolve(import.meta.dirname, "../../tokens.css"), "utf8");
const tokens = new Map<string, string>();
for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) {
  if (!tokens.has(m[1] as string)) tokens.set(m[1] as string, m[2] as string);
}

function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

export function contraste(a: string, b: string): number {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (l1 + 0.05) / (l2 + 0.05);
}

const FUNDOS = ["bg", "sidebar", "surface", "surface-2"];
const TEXTOS = [
  "text",
  "text-2",
  "text-3",
  "link",
  "accent",
  "up",
  "down",
  "warn",
  "benchmark",
  "series-2",
  "series-3",
  "series-4",
  "series-5",
  "series-6",
];

const PARES: [string, string][] = [
  ...TEXTOS.flatMap((t) => FUNDOS.map((f): [string, string] => [t, f])),
  ["on-accent", "accent"],
  ["accent-soft-text", "accent-soft"],
  ["warn", "warn-bg"],
  ["on-down", "down"],
  ["up-strong", "up-soft"],
  ["down-strong", "down-soft"],
  ["series-3-strong", "series-3-soft"],
];

describe("contraste dos tokens", () => {
  it("le os tokens do arquivo", () => {
    expect(tokens.get("bg")).toBe("#0B0F14");
    expect(tokens.get("accent")).toBe("#6C9CFF");
  });

  it.each(PARES)("%s sobre %s passa de 4,5:1", (texto, fundo) => {
    const t = tokens.get(texto);
    const f = tokens.get(fundo);
    expect(t, `token --${texto}`).toBeDefined();
    expect(f, `token --${fundo}`).toBeDefined();
    expect(contraste(t as string, f as string)).toBeGreaterThanOrEqual(4.5);
  });
});
