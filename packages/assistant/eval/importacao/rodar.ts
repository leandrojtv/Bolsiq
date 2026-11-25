/**
 * make eval-importacao
 *
 * EVAL_PROVEDOR, EVAL_MODELO, EVAL_CHAVE e EVAL_URL escolhem o modelo real. Sem
 * eles roda o roteiro (respostas gravadas), que confere o pipeline e os
 * validadores, mas nao homologa. Modelo real aprovado grava o resultado em
 * homologacao/importacao-<provedor>-<modelo>.json e vira `importacao: homologado`
 * em homologacao/modelos.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  capacidadesDoModelo,
  NOMES_DE_PROVEDOR,
  type Provedor,
} from "../../src/catalogo.js";
import { VERSAO_DO_PROMPT_DE_IMPORTACAO } from "../../prompts/importacao-v1.js";
import { criarModelo } from "../../src/provedores.js";
import {
  executarFixture,
  medir,
  modeloDeRoteiro,
  resumirMedidas,
  type MedidaDaFixture,
} from "./executar.js";
import { FIXTURES } from "./fixtures.js";
import {
  executarFixtureDeFinancas,
  medirFinancas,
  resumirFinancas,
  type MedidaDeFinancas,
} from "./executar-financas.js";
import { FIXTURES_DE_FINANCAS } from "./fixtures-financas.js";
import { VERSAO_DO_PROMPT_DE_FINANCAS } from "../../prompts/importacao-financas-v1.js";

const { EVAL_PROVEDOR, EVAL_MODELO, EVAL_CHAVE, EVAL_URL, EVAL_FIXTURES } = process.env;
const raiz =
  process.env.EVAL_RAIZ ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const escrever = (t: string) => process.stdout.write(`${t}\n`);

const real = Boolean(EVAL_PROVEDOR && EVAL_MODELO);
if (real && !NOMES_DE_PROVEDOR.includes(EVAL_PROVEDOR as Provedor)) {
  process.stderr.write(`provedor desconhecido: ${EVAL_PROVEDOR}\n`);
  process.exit(2);
}

const capacidades = real
  ? capacidadesDoModelo(EVAL_PROVEDOR as Provedor, EVAL_MODELO as string)
  : { saida_estruturada: true, visao: true, max_saida: 16_000, contexto: 200_000 };
// Basta texto: sem saida estruturada, o cabecalho vai por JSON em texto.
if (real && !capacidades.saida_estruturada)
  escrever(
    `${EVAL_PROVEDOR}/${EVAL_MODELO} sem saída estruturada: cabeçalho por JSON em texto.`,
  );

const fixtures = (
  EVAL_FIXTURES
    ? FIXTURES.filter((f) => EVAL_FIXTURES.split(",").includes(f.id))
    : FIXTURES
)
  // Sem visao, a fixture escaneada nao se aplica: o modelo nao aparece para ela.
  .filter((f) => !f.esperado.visao || capacidades.visao);
const nome = real ? `${EVAL_PROVEDOR}/${EVAL_MODELO}` : "roteiro (não homologa)";
escrever(`Avaliando importação com ${nome}: ${fixtures.length} fixtures`);

const medidas: MedidaDaFixture[] = [];
for (const f of fixtures) {
  const modelo = real
    ? criarModelo(
        {
          provedor: EVAL_PROVEDOR as Provedor,
          chave: EVAL_CHAVE ?? null,
          baseUrl: EVAL_URL ?? null,
        },
        EVAL_MODELO as string,
      )
    : modeloDeRoteiro(f.resposta);
  let m: MedidaDaFixture;
  try {
    m = medir(f, await executarFixture(f, modelo, { capacidades }));
  } catch (erro) {
    m = medir(
      f,
      null,
      (erro as Error).message.replace(EVAL_CHAVE ?? "\u0000", "[removido]"),
    );
  }
  medidas.push(m);
  const ok =
    m.faltantes.length === 0 &&
    m.inventados.length === 0 &&
    m.conciliacao_certa &&
    m.campos_certos === m.campos_total;
  escrever(
    `${ok ? "ok   " : "FALHA"} ${f.id}` +
      (ok
        ? ""
        : ` campos=${m.campos_certos}/${m.campos_total} conciliacao=${m.conciliacao_certa}` +
          ` faltantes=[${m.faltantes.join(", ")}] inventados=[${m.inventados.join(", ")}]` +
          (m.erro ? ` erro=${m.erro}` : "")),
  );
}

// Faturas e extratos do Financas (ADR 0040): sempre pela IA, mesmo nos
// layouts que tem atalho, para medir o modelo em todos os bancos.
const deFinancas = EVAL_FIXTURES
  ? FIXTURES_DE_FINANCAS.filter((f) => EVAL_FIXTURES.split(",").includes(f.id))
  : FIXTURES_DE_FINANCAS;
const medidasDeFinancas: MedidaDeFinancas[] = [];
for (const f of deFinancas) {
  const modelo = real
    ? criarModelo(
        {
          provedor: EVAL_PROVEDOR as Provedor,
          chave: EVAL_CHAVE ?? null,
          baseUrl: EVAL_URL ?? null,
        },
        EVAL_MODELO as string,
      )
    : modeloDeRoteiro(f.resposta);
  let m: MedidaDeFinancas;
  try {
    m = medirFinancas(
      f,
      await executarFixtureDeFinancas(f, modelo, { capacidades, sem_atalho: true }),
    );
  } catch (erro) {
    m = medirFinancas(
      f,
      null,
      (erro as Error).message.replace(EVAL_CHAVE ?? "\u0000", "[removido]"),
    );
  }
  medidasDeFinancas.push(m);
  const ok =
    m.faltantes.length === 0 &&
    m.inventadas.length === 0 &&
    m.total_conferido &&
    m.parcelas_certas === m.parcelas_esperadas;
  escrever(
    `${ok ? "ok   " : "FALHA"} ${f.id}` +
      (ok
        ? ""
        : ` linhas=${m.linhas_extraidas}/${m.linhas_esperadas} total=${m.total_conferido}` +
          ` parcelas=${m.parcelas_certas}/${m.parcelas_esperadas}` +
          ` faltantes=[${m.faltantes.join(", ")}] inventadas=[${m.inventadas.join(", ")}]` +
          (m.erro ? ` erro=${m.erro}` : "")),
  );
}

const resumoDaCarteira = resumirMedidas(medidas);
const financas = resumirFinancas(medidasDeFinancas);
const resumo = {
  ...resumoDaCarteira,
  // Fixtures filtradas sem nenhuma do Financas: vale so a carteira.
  aprovado:
    resumoDaCarteira.aprovado && (medidasDeFinancas.length === 0 || financas.aprovado),
  financas,
};
escrever(JSON.stringify(resumo, null, 2));

if (real && !EVAL_FIXTURES) {
  const slug = `${EVAL_PROVEDOR}-${(EVAL_MODELO as string).replace(/[^A-Za-z0-9.-]+/g, "-")}`;
  const pasta = resolve(raiz, "homologacao");
  mkdirSync(pasta, { recursive: true });
  const arquivo = `importacao-${slug}.json`;
  writeFileSync(
    resolve(pasta, arquivo),
    `${JSON.stringify(
      {
        provedor: EVAL_PROVEDOR,
        modelo: EVAL_MODELO,
        prompt: VERSAO_DO_PROMPT_DE_IMPORTACAO,
        prompt_financas: VERSAO_DO_PROMPT_DE_FINANCAS,
        data: new Date().toISOString().slice(0, 10),
        resumo,
        fixtures: medidas,
        fixtures_financas: medidasDeFinancas,
      },
      null,
      2,
    )}\n`,
  );
  if (resumo.aprovado) {
    const caminho = resolve(pasta, "modelos.json");
    const lista = JSON.parse(readFileSync(caminho, "utf8")) as {
      modelos: {
        provedor: string;
        modelo: string;
        importacao?: string;
        avaliacao_importacao?: string;
      }[];
    };
    const atual = lista.modelos.find(
      (m) => m.provedor === EVAL_PROVEDOR && m.modelo === EVAL_MODELO,
    );
    if (atual) {
      Object.assign(atual, { importacao: "homologado", avaliacao_importacao: arquivo });
      writeFileSync(caminho, `${JSON.stringify(lista, null, 2)}\n`);
      escrever(`Homologado para importar: ${nome}. Resultado em homologacao/${arquivo}`);
    } else
      escrever(`${nome} fora de modelos.json: inclua com as capacidades e rode de novo.`);
  }
}
if (!real)
  escrever(
    "Roteiro confere o pipeline e os validadores. Para homologar, informe EVAL_PROVEDOR e EVAL_MODELO.",
  );

process.exit(resumo.aprovado ? 0 : 1);
