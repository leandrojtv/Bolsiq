/**
 * Arquivos do e2e da importacao com IA, gerados das fixtures: o XLSX que o
 * Playwright sobe e a resposta gravada que o provedor falso devolve.
 * Rode `pnpm --filter @bolsiq/assistant run e2e:importacao` ao mudar a fixture.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arquivosDoE2e, CAMINHO_DA_RESPOSTA, CAMINHO_DO_XLSX } from "./e2e.js";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const { xlsx, respostas } = arquivosDoE2e();
mkdirSync(dirname(resolve(raiz, CAMINHO_DO_XLSX)), { recursive: true });
writeFileSync(resolve(raiz, CAMINHO_DO_XLSX), xlsx);
writeFileSync(
  resolve(raiz, CAMINHO_DA_RESPOSTA),
  `${JSON.stringify(respostas, null, 2)}\n`,
);
process.stdout.write(`${CAMINHO_DO_XLSX} e ${CAMINHO_DA_RESPOSTA} atualizados\n`);
