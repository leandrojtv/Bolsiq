/**
 * As regras da importacao com IA vivem em docs/importacao/prompt-normalizacao.md,
 * entre os marcadores abaixo. `importacao-regras.ts` e gerado daqui.
 */
export const INICIO = "<!-- regras-importacao:inicio -->";
export const FIM = "<!-- regras-importacao:fim -->";

/** O bloco ```text entre os marcadores, sem as cercas. */
export function regrasDoMarkdown(md: string): string {
  const i = md.indexOf(INICIO);
  const f = md.indexOf(FIM);
  if (i === -1 || f === -1 || f < i)
    throw new Error("marcadores de regras não encontrados no Markdown");
  const bloco = /```text\n([\s\S]*?)\n```/.exec(md.slice(i, f));
  if (!bloco?.[1]) throw new Error("bloco ```text não encontrado entre os marcadores");
  return bloco[1];
}

/** Template literal: o Prettier nao reescreve, e o texto fica legivel no diff. */
const literal = (s: string) =>
  `\`${s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\``;

export const arquivoGerado = (regras: string): string =>
  [
    "// Gerado de docs/importacao/prompt-normalizacao.md por prompts/gerar-importacao.ts.",
    "// Nao edite aqui: edite o Markdown e rode `make prompt-importacao`.",
    `export const REGRAS_DE_NORMALIZACAO = ${literal(regras)};`,
    "",
  ].join("\n");
