// Procura chave de API no que o navegador recebe (.next/static).
//
// Duas buscas: o prefixo de chave do Bolsiq (mdk_live_ e mdk_test_) e, se
// definida no ambiente do build, a propria MARKET_DATA_API_KEY. Qualquer uma
// no bundle reprova.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const raiz = new URL("../.next/static", import.meta.url).pathname;
const chave = process.env.MARKET_DATA_API_KEY;
const padroes = [/mdk_(live|test)_[A-Za-z0-9_]+/];
if (chave) padroes.push(new RegExp(chave.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

function* arquivos(dir) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) yield* arquivos(caminho);
    else yield caminho;
  }
}

let lidos = 0;
const achados = [];
for (const arquivo of arquivos(raiz)) {
  lidos++;
  const texto = readFileSync(arquivo, "latin1");
  for (const p of padroes) if (p.test(texto)) achados.push(arquivo);
}

if (lidos === 0) {
  process.stderr.write("nenhum arquivo em .next/static: rode o build antes\n");
  process.exit(1);
}
if (achados.length > 0) {
  process.stderr.write(`chave de API no bundle do navegador:\n${achados.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`bundle limpo: ${lidos} arquivos sem chave de API\n`);
