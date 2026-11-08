/** Regera importacao-regras.ts a partir do Markdown (fonte unica das regras). */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arquivoGerado, regrasDoMarkdown } from "./fonte-importacao.js";

const pacote = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const md = readFileSync(
  resolve(pacote, "../../docs/importacao/prompt-normalizacao.md"),
  "utf8",
);
writeFileSync(
  resolve(pacote, "prompts/importacao-regras.ts"),
  arquivoGerado(regrasDoMarkdown(md)),
);
process.stdout.write("prompts/importacao-regras.ts atualizado\n");
