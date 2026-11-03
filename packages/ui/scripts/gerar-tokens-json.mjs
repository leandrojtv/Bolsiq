// Gera dist/tokens.json a partir de tokens.css: os mesmos valores, para quem
// nao le CSS (e-mail, que precisa de estilo inline). Roda no build.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const raiz = new URL("..", import.meta.url).pathname;
const css = readFileSync(`${raiz}tokens.css`, "utf8");
// O bloco do tema claro comeca numa linha propria; o comentario do topo tambem
// cita o seletor, entao a busca e pela linha.
const bloco = css.slice(0, css.search(/^\[data-theme="light"\]/m));
const tokens = {};
for (const m of bloco.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6}|\d+px)\s*;/g)) {
  tokens[m[1]] ??= m[2];
}
mkdirSync(`${raiz}dist`, { recursive: true });
writeFileSync(`${raiz}dist/tokens.json`, `${JSON.stringify(tokens, null, 2)}\n`);
