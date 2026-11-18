/**
 * make eval-assistente
 *
 * EVAL_PROVEDOR, EVAL_MODELO, EVAL_CHAVE e EVAL_URL escolhem o modelo real. Sem
 * eles roda o roteiro, que confere o harness e as ferramentas mas nao homologa.
 * Modelo real aprovado grava o resultado em homologacao/ e vira "homologado" em
 * homologacao/modelos.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NOMES_DE_PROVEDOR, type Provedor } from "../src/catalogo.js";
import { VERSAO_DO_PROMPT } from "../prompts/sistema-v1.js";
import { criarModelo } from "../src/provedores.js";
import { CASOS } from "./casos.js";
import { executarCaso, resumir, type ResultadoDoCaso } from "./executar.js";
import { modeloDeRoteiro } from "./roteiro.js";

const { EVAL_PROVEDOR, EVAL_MODELO, EVAL_CHAVE, EVAL_URL, EVAL_CASOS } = process.env;
const raiz =
  process.env.EVAL_RAIZ ?? resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const escrever = (t: string) => process.stdout.write(`${t}\n`);

const real = Boolean(EVAL_PROVEDOR && EVAL_MODELO);
if (real && !NOMES_DE_PROVEDOR.includes(EVAL_PROVEDOR as Provedor)) {
  process.stderr.write(`provedor desconhecido: ${EVAL_PROVEDOR}\n`);
  process.exit(2);
}

const casos = EVAL_CASOS
  ? CASOS.filter((c) => EVAL_CASOS.split(",").includes(c.id))
  : CASOS;
const nome = real ? `${EVAL_PROVEDOR}/${EVAL_MODELO}` : "roteiro (não homologa)";
escrever(`Avaliando ${nome}: ${casos.length} casos`);

const resultados: ResultadoDoCaso[] = [];
for (const caso of casos) {
  const r = await executarCaso(caso, (c) =>
    real
      ? criarModelo(
          {
            provedor: EVAL_PROVEDOR as Provedor,
            chave: EVAL_CHAVE ?? null,
            baseUrl: EVAL_URL ?? null,
          },
          EVAL_MODELO as string,
        )
      : modeloDeRoteiro(c),
  );
  resultados.push(r);
  const ok =
    r.ferramenta_certa &&
    r.parametros_certos &&
    r.numeros_certos &&
    r.texto_certo &&
    r.ativos_fora_da_lista.length === 0;
  escrever(
    `${ok ? "ok   " : "FALHA"} ${caso.id}` +
      (ok
        ? ""
        : ` ferramenta=${r.ferramenta_certa} parametros=${r.parametros_certos} numeros=${r.numeros_certos} texto=${r.texto_certo}` +
          ` faltando=[${r.numeros_faltando.join(",")}] sem_origem=[${r.numeros_sem_origem.join(",")}]` +
          ` fora=[${r.ativos_fora_da_lista.join(",")}] chamadas=[${r.chamadas.map((c) => c.nome).join(",")}]` +
          (r.erro ? ` erro=${r.erro}` : "")),
  );
}

const resumo = resumir(resultados);
escrever(JSON.stringify(resumo, null, 2));

if (real && !EVAL_CASOS) {
  const slug = `${EVAL_PROVEDOR}-${(EVAL_MODELO as string).replace(/[^A-Za-z0-9.-]+/g, "-")}`;
  const pasta = resolve(raiz, "homologacao");
  mkdirSync(pasta, { recursive: true });
  const arquivo = `${slug}.json`;
  writeFileSync(
    resolve(pasta, arquivo),
    `${JSON.stringify(
      {
        provedor: EVAL_PROVEDOR,
        modelo: EVAL_MODELO,
        prompt: VERSAO_DO_PROMPT,
        data: new Date().toISOString().slice(0, 10),
        resumo,
        casos: resultados.map(({ resposta, ...r }) => ({
          ...r,
          resposta: resposta.slice(0, 2000),
        })),
      },
      null,
      2,
    )}\n`,
  );
  if (resumo.aprovado) {
    const caminho = resolve(pasta, "modelos.json");
    const lista = JSON.parse(readFileSync(caminho, "utf8")) as {
      modelos: { provedor: string; modelo: string; status: string; avaliacao?: string }[];
    };
    const atual = lista.modelos.find(
      (m) => m.provedor === EVAL_PROVEDOR && m.modelo === EVAL_MODELO,
    );
    if (atual) Object.assign(atual, { status: "homologado", avaliacao: arquivo });
    else
      lista.modelos.push({
        provedor: EVAL_PROVEDOR as string,
        modelo: EVAL_MODELO as string,
        status: "homologado",
        avaliacao: arquivo,
        ...(EVAL_PROVEDOR === "ollama" ? { preco_entrada: 0, preco_saida: 0 } : {}),
      });
    writeFileSync(caminho, `${JSON.stringify(lista, null, 2)}\n`);
    escrever(`Homologado: ${nome}. Resultado em homologacao/${arquivo}`);
  }
}
if (!real)
  escrever(
    "Roteiro confere harness e ferramentas. Para homologar, informe EVAL_PROVEDOR e EVAL_MODELO.",
  );

process.exit(resumo.aprovado ? 0 : 1);
