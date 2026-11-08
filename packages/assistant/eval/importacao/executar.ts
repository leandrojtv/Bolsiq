import { Decimal } from "decimal.js";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { SaidaDaIA } from "../../src/importacao/esquema.js";
import { prepararArquivo, type Capacidades } from "../../src/importacao/pipeline.js";
import {
  importarComIA,
  type ArmazemDeImportacao,
  type ResultadoDaImportacaoComIA,
} from "../../src/importacao/servico.js";
import type { LinhaProposta, Verificador } from "../../src/importacao/validacao.js";
import type { Uso } from "../../src/orcamento.js";
import { FAIXAS, HOJE, TICKERS, type Fixture, type LinhaEsperada } from "./fixtures.js";

export const verificadorDasFixtures = (): Verificador => ({
  tickersExistentes: (ts) => Promise.resolve(new Set(ts.filter((t) => TICKERS.has(t)))),
  faixaDoDia: (t, d) => Promise.resolve(FAIXAS[`${t}|${d}`] ?? null),
});

/** Cache e consumo em memoria, com a mesma interface do BFF. */
export function armazemEmMemoria() {
  const extracoes = new Map<string, { id: string; saida: unknown }>();
  const consumo: { uso: Uso; custo: string | null }[] = [];
  let feitas = 0;
  const armazem: ArmazemDeImportacao = {
    buscar: (c) =>
      Promise.resolve(
        extracoes.get(`${c.hash}|${c.versao_prompt}|${c.provedor}|${c.modelo}`) ?? null,
      ),
    feitasHoje: () => Promise.resolve(feitas),
    gravar: (r) => {
      const id = `ext-${extracoes.size + 1}`;
      const c = r.chave;
      extracoes.set(`${c.hash}|${c.versao_prompt}|${c.provedor}|${c.modelo}`, {
        id,
        saida: r.saida,
      });
      feitas++;
      return Promise.resolve(id);
    },
    atualizarRelatorio: () => Promise.resolve(),
    registrarUso: (uso, custo) => {
      consumo.push({ uso, custo });
      return Promise.resolve();
    },
  };
  return { armazem, consumo, extracoes };
}

const USO = {
  inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 500, text: 500, reasoning: 0 },
};

/** Modelo de mentira que devolve a resposta gravada. Confere o harness, nao homologa. */
export function modeloDeRoteiro(resposta: SaidaDaIA): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "roteiro",
    modelId: "roteiro",
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: "text", text: JSON.stringify(resposta) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: USO,
        warnings: [],
      }),
  });
}

export const CAPACIDADES_COMPLETAS: Capacidades = {
  saida_estruturada: true,
  visao: true,
  max_saida: 16_000,
};

export async function executarFixture(
  f: Fixture,
  modelo: LanguageModel,
  o: {
    provedor?: string;
    nome?: string;
    capacidades?: Capacidades;
    armazem?: ArmazemDeImportacao;
    preco?: { entrada: number | null; saida: number | null };
  } = {},
): Promise<ResultadoDaImportacaoComIA> {
  const capacidades = o.capacidades ?? CAPACIDADES_COMPLETAS;
  const arquivo = await prepararArquivo(f.arquivo(), capacidades.max_saida);
  return importarComIA({
    arquivo,
    original: null,
    modelo,
    provedor: o.provedor ?? "roteiro",
    nome_do_modelo: o.nome ?? "roteiro",
    preco: o.preco ?? { entrada: 1, saida: 2 },
    capacidades,
    armazem: o.armazem ?? armazemEmMemoria().armazem,
    verificador: verificadorDasFixtures(),
    hoje: HOJE,
    limite_diario: 100,
    aceitou_enviar_imagem: true,
    segredos: [],
  });
}

// ---------------------------------------------------------------------------
// Medidas
// ---------------------------------------------------------------------------

const igual = (a: string | undefined, b: string): boolean => {
  if (a === undefined) return false;
  try {
    return new Decimal(a).eq(new Decimal(b));
  } catch {
    return a.trim().toUpperCase() === b.trim().toUpperCase();
  }
};

/** Campos que identificam a linha: o ativo e, na transacao, data e quantidade. */
const IDENTIDADE = ["classe", "codigo", "ticker", "data", "tipo", "quantidade"] as const;

/** A esperada casa com a obtida quando os campos de identidade que ela traz batem. */
function casa(e: LinhaEsperada, o: LinhaProposta): boolean {
  if (e.tipo !== o.tipo) return false;
  const campos = IDENTIDADE.filter((c) => e.campos[c] !== undefined);
  const porNome = e.campos.codigo === undefined && e.campos.ticker === undefined;
  return (
    campos.every((c) => igual(o.dados[c], e.campos[c] as string)) &&
    (!porNome || igual(o.dados.ativo, e.campos.ativo ?? ""))
  );
}

const rotulo = (tipo: string, c: Record<string, string>) =>
  [tipo, c.classe, c.codigo || c.ticker || c.ativo, c.data].filter(Boolean).join("|");

export interface MedidaDaFixture {
  id: string;
  campos_certos: number;
  campos_total: number;
  linhas_esperadas: number;
  faltantes: string[];
  inventados: string[];
  conciliacao_certa: boolean;
  erro: string | null;
}

export function medir(
  f: Fixture,
  r: ResultadoDaImportacaoComIA | null,
  erro: string | null = null,
): MedidaDaFixture {
  const total = f.esperado.linhas.reduce((s, l) => s + Object.keys(l.campos).length, 0);
  if (!r)
    return {
      id: f.id,
      campos_certos: 0,
      campos_total: total,
      linhas_esperadas: f.esperado.linhas.length,
      faltantes: f.esperado.linhas.map((l) => rotulo(l.tipo, l.campos)),
      inventados: [],
      conciliacao_certa: false,
      erro,
    };
  const obtidas = [...r.validacao.linhas];
  let certos = 0;
  const faltantes: string[] = [];
  for (const e of f.esperado.linhas) {
    const i = obtidas.findIndex((o) => casa(e, o));
    const o = i === -1 ? undefined : obtidas.splice(i, 1)[0];
    if (!o) {
      faltantes.push(rotulo(e.tipo, e.campos));
      continue;
    }
    for (const [campo, valor] of Object.entries(e.campos))
      if (igual(o.dados[campo], valor)) certos++;
  }
  return {
    id: f.id,
    campos_certos: certos,
    campos_total: total,
    linhas_esperadas: f.esperado.linhas.length,
    faltantes,
    inventados: obtidas.map((o) => rotulo(o.tipo, o.dados)),
    conciliacao_certa: r.validacao.conciliada === f.esperado.conciliada,
    erro,
  };
}

export const CRITERIOS = { acerto_por_campo: 0.95, linhas_faltantes: 0.05 } as const;

export function resumirMedidas(m: MedidaDaFixture[]) {
  const soma = (f: (x: MedidaDaFixture) => number) => m.reduce((s, x) => s + f(x), 0);
  const acerto =
    soma((x) => x.campos_certos) /
    Math.max(
      1,
      soma((x) => x.campos_total),
    );
  const faltantes = soma((x) => x.faltantes.length);
  const fracaoFaltante =
    faltantes /
    Math.max(
      1,
      soma((x) => x.linhas_esperadas),
    );
  const inventados = soma((x) => x.inventados.length);
  const conciliacao = m.filter((x) => x.conciliacao_certa).length / Math.max(1, m.length);
  return {
    fixtures: m.length,
    acerto_por_campo: Number(acerto.toFixed(4)),
    conciliacao_de_totais: Number(conciliacao.toFixed(4)),
    ativos_inventados: inventados,
    linhas_faltantes: faltantes,
    aprovado:
      m.length > 0 &&
      acerto >= CRITERIOS.acerto_por_campo &&
      conciliacao === 1 &&
      inventados === 0 &&
      fracaoFaltante <= CRITERIOS.linhas_faltantes,
  };
}
