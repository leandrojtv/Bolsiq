/**
 * As regras da importacao com IA e o formato da resposta vivem em
 * docs/importacao/prompt-normalizacao.md, entre marcadores. `importacao-regras.ts`
 * e gerado daqui.
 */

/** O bloco de texto (```text, ````text ou ~~~text) entre os marcadores `<nome>:inicio` e `:fim`. */
export function blocoDoMarkdown(md: string, nome: string): string {
  const i = md.indexOf(`<!-- ${nome}:inicio -->`);
  const f = md.indexOf(`<!-- ${nome}:fim -->`);
  if (i === -1 || f === -1 || f < i)
    throw new Error(`marcadores de ${nome} não encontrados no Markdown`);
  // O Prettier troca ~~~ por ```` quando o bloco tem ``` dentro: valem os dois.
  const bloco = /(`{3,}|~{3,})text\n([\s\S]*?)\n\1(?![`~])/.exec(md.slice(i, f));
  if (!bloco?.[2])
    throw new Error(`bloco de texto não encontrado entre os marcadores de ${nome}`);
  return bloco[2];
}

export const regrasDoMarkdown = (md: string) => blocoDoMarkdown(md, "regras-importacao");
export const formatoDoMarkdown = (md: string) =>
  blocoDoMarkdown(md, "formato-importacao");

/** Template literal: o Prettier nao reescreve, e o texto fica legivel no diff. */
const literal = (s: string) =>
  `\`${s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\``;

export const arquivoGerado = (md: string): string =>
  [
    "// Gerado de docs/importacao/prompt-normalizacao.md por prompts/gerar-importacao.ts.",
    "// Nao edite aqui: edite o Markdown e rode `make prompt-importacao`.",
    `export const REGRAS_DE_NORMALIZACAO = ${literal(regrasDoMarkdown(md))};`,
    "",
    `export const FORMATO_DE_SAIDA = ${literal(formatoDoMarkdown(md))};`,
    "",
  ].join("\n");
