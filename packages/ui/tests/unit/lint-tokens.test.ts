import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { regrasDeToken } from "../../eslint-tokens.js";

/** A propria guarda tem teste: regra que nunca dispara passa despercebida. */
const linter = new Linter({ configType: "flat" });
const config: Linter.Config[] = [
  {
    files: ["**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: { "no-restricted-syntax": ["error", ...regrasDeToken] },
  },
];

function erros(codigo: string): string[] {
  return linter.verify(codigo, config, "x.tsx").map((m) => m.message);
}

describe("lint de tokens", () => {
  it.each([
    ['const a = <div style={{ color: "#6C9CFF" }} />;', "Cor hex"],
    ['const a = <div className="bg-[#0B0F14]" />;', "Cor hex"],
    ["const a = `border: 1px solid #fff`;", "Cor hex"],
    ['const a = { color: "rgba(0,0,0,.5)" };', "Cor literal"],
    ['const a = { fontFamily: "Inter, sans-serif" };', "Fonte"],
    ['const a = <span className="font-[JetBrains]" />;', "Fonte arbitrária"],
  ])("reprova %s", (codigo, esperado) => {
    expect(erros(codigo).join(" ")).toContain(esperado);
  });

  it.each([
    'const a = <div className="bg-surface text-up font-mono" />;',
    'const a = <div style={{ background: "var(--surface)" }} />;',
    'const a = <a href="#topo">Interruptor</a>;',
  ])("aceita %s", (codigo) => {
    expect(erros(codigo)).toEqual([]);
  });
});
