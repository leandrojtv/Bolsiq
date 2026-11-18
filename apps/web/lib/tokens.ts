import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Valor de um token de tokens.css, para onde CSS nao chega: manifest do PWA e
 * icone gerado. Lido no build (rotas estaticas), entao o servidor nao precisa
 * do arquivo em producao.
 */
export function valorDoToken(nome: string): string {
  // Pelo node_modules do app (link do workspace). import.meta.url nao existe
  // nas rotas que o Turbopack pre-renderiza.
  const caminho = join(process.cwd(), "node_modules/@bolsiq/ui/tokens.css");
  const css = readFileSync(caminho, "utf8");
  const achado = new RegExp(`--${nome}:\\s*([^;]+);`).exec(css);
  if (!achado?.[1]) throw new Error(`token --${nome} nao encontrado em tokens.css`);
  return achado[1].trim();
}
