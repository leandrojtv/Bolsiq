/**
 * Arquivos do e2e da importacao com IA, gerados das fixtures: os extratos que o
 * Playwright sobe e as respostas gravadas que o provedor falso devolve.
 * Rode `pnpm --filter @bolsiq/assistant run e2e:importacao` ao mudar uma fixture.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arquivosDoE2e, CAMINHO_DA_RESPOSTA } from "./e2e.js";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const { arquivos, respostas } = arquivosDoE2e();
for (const a of arquivos) {
  mkdirSync(dirname(resolve(raiz, a.caminho)), { recursive: true });
  writeFileSync(resolve(raiz, a.caminho), a.bytes);
}
writeFileSync(
  resolve(raiz, CAMINHO_DA_RESPOSTA),
  `${JSON.stringify(respostas, null, 2)}\n`,
);
process.stdout.write(
  `${arquivos.length} arquivos e ${CAMINHO_DA_RESPOSTA} atualizados\n`,
);
