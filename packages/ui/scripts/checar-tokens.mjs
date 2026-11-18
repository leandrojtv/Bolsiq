// Complemento do lint para CSS: o ESLint nao le .css. Reprova hex, funcao de
// cor e font-family com valor literal em qualquer CSS de packages/ui que nao
// seja tokens.css.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const raiz = new URL("..", import.meta.url).pathname;
const IGNORAR = new Set([
  "node_modules",
  "dist",
  "storybook-static",
  "coverage",
  "test-results",
  "playwright-report",
]);
const PERMITIDO = new Set(["tokens.css"]);

const regras = [
  [/#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/, "cor hex"],
  [/\b(rgba?|hsla?|oklch|oklab|hwb)\(/, "funcao de cor"],
  [/font-family:(?!\s*var\()/, "font-family literal"],
];

function* arquivos(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(e.name)) continue;
    const caminho = join(dir, e.name);
    if (e.isDirectory()) yield* arquivos(caminho);
    else if (e.name.endsWith(".css") && !PERMITIDO.has(e.name)) yield caminho;
  }
}

let falhas = 0;
for (const arquivo of arquivos(raiz)) {
  readFileSync(arquivo, "utf8")
    .split("\n")
    .forEach((linha, i) => {
      if (linha.trim().startsWith("/*") || linha.trim().startsWith("*")) return;
      for (const [re, oque] of regras) {
        if (re.test(linha)) {
          falhas++;
          process.stderr.write(
            `${relative(raiz, arquivo)}:${i + 1}: ${oque} fora de tokens.css\n`,
          );
        }
      }
    });
}
if (falhas > 0) process.exit(1);
