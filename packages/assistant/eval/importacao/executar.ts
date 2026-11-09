import { Decimal } from "decimal.js";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { CabecalhoDaIA, SaidaDaIA } from "../../src/importacao/esquema.js";
import {
  SenhaIncorreta,
  type FerramentasDoSistema,
} from "../../src/importacao/ferramentas.js";
import type { SaidaDasLinhas } from "../../src/importacao/saida-csv.js";
import { escreverBlocos } from "../../src/importacao/saida-csv.js";
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

/** O cabecalho que um modelo correto devolveria para a fixture. */
export const cabecalhoDa = (r: SaidaDaIA): CabecalhoDaIA => ({
  ...r.documento,
  avisos: r.avisos,
});

/**
 * A resposta gravada para um pedido: o cabecalho em JSON, ou as linhas em blocos
 * CSV so das paginas e abas que estao no pedido (como um modelo faria com o
 * lote). Pedido de visao, sem bloco de documento, leva todas as linhas.
 */
export type FormaDoPedido = "json" | "cabecalho_em_texto" | "linhas" | "correcao";

export function respostaGravada(
  r: SaidaDaIA,
  pedido: string,
  forma: FormaDoPedido,
  correcao?: SaidaDasLinhas,
): string {
  if (forma === "json") return JSON.stringify(cabecalhoDa(r));
  if (forma === "cabecalho_em_texto")
    return `Segue o cabeçalho:\n\`\`\`json\n${JSON.stringify(cabecalhoDa(r))}\n\`\`\``;
  if (forma === "correcao") return correcao ? escreverBlocos(correcao) : "";
  // Lote de texto: os blocos <documento>. Lote de imagens: a lista "na ordem: ...".
  const imagens = /na ordem: ([^.]+)\./.exec(pedido)?.[1]?.split(", ") ?? [];
  const origens = new Set(
    [
      ...[...pedido.matchAll(/<documento origem=\\?"([^"\\]+)\\?">/g)].map(
        (m) => m[1] ?? "",
      ),
      ...imagens,
    ].map((x) => x.toLowerCase()),
  );
  const daqui = <T extends { origem: { pagina_ou_aba: string } }>(xs: T[]) =>
    origens.size === 0
      ? xs
      : xs.filter((x) => origens.has(x.origem.pagina_ou_aba.toLowerCase()));
  return escreverBlocos({
    posicoes: daqui(r.posicoes),
    transacoes: daqui(r.transacoes),
    proventos: daqui(r.proventos),
    notas: daqui(r.notas),
    malformadas: [],
  });
}

/** O pedido do cabecalho, pelo prompt de sistema. */
export const pedeCabecalho = (pedido: string) => pedido.includes("leia só o cabeçalho");
/** O pedido de autocorrecao, pelo texto do usuario. */
export const pedeCorrecao = (pedido: string) =>
  pedido.includes("recusou as linhas abaixo");

export const formaDoPedido = (pedido: string, json: boolean): FormaDoPedido =>
  json
    ? "json"
    : pedeCabecalho(pedido)
      ? "cabecalho_em_texto"
      : pedeCorrecao(pedido)
        ? "correcao"
        : "linhas";

export interface OpcoesDoRoteiro {
  /** O provedor recusa o schema do cabecalho (como o erro de gramatica). */
  recusarSchema?: boolean;
  /** As primeiras N respostas de linhas vem cortadas pelo limite de saida. */
  truncar?: number;
  /** As primeiras N chamadas de linhas falham com este status (429, 500). */
  falhar?: { vezes: number; status: number };
  /** Lotes (por origem) que falham sempre, para ver o lote isolado. */
  falharOrigem?: string;
  /** O que a autocorrecao devolve. */
  correcao?: SaidaDasLinhas;
}

/** Modelo de mentira que devolve a resposta gravada. Confere o harness, nao homologa. */
export function modeloDeRoteiro(
  resposta: SaidaDaIA,
  o: OpcoesDoRoteiro = {},
): MockLanguageModelV4 {
  let truncadas = 0;
  let falhas = 0;
  return new MockLanguageModelV4({
    provider: "roteiro",
    modelId: "roteiro",
    doGenerate: (opcoes) => {
      const pedido = JSON.stringify(opcoes.prompt);
      const json = opcoes.responseFormat?.type === "json";
      if (json && o.recusarSchema)
        return Promise.reject(
          Object.assign(new Error("The compiled grammar is too large"), {
            statusCode: 400,
          }),
        );
      const forma = formaDoPedido(pedido, json);
      if (forma === "linhas" && o.falhar && falhas < o.falhar.vezes) {
        falhas++;
        return Promise.reject(
          Object.assign(new Error("Too Many Requests"), { statusCode: o.falhar.status }),
        );
      }
      if (forma === "linhas" && o.falharOrigem && pedido.includes(o.falharOrigem))
        return Promise.reject(
          Object.assign(new Error("Bad Gateway"), { statusCode: 502 }),
        );
      const cortar = forma === "linhas" && truncadas < (o.truncar ?? 0);
      if (cortar) truncadas++;
      const texto = respostaGravada(resposta, pedido, forma, o.correcao);
      return Promise.resolve({
        content: [
          {
            type: "text",
            text: cortar ? texto.slice(0, Math.floor(texto.length / 2)) : texto,
          },
        ],
        finishReason: { unified: cortar ? "length" : "stop", raw: undefined },
        usage: USO,
        warnings: [],
      });
    },
  });
}

export const CAPACIDADES_COMPLETAS: Capacidades = {
  saida_estruturada: true,
  visao: true,
  max_saida: 16_000,
  contexto: 200_000,
};

/**
 * Programas do sistema de mentira: a "imagem" de uma pagina e o numero dela, e
 * o OCR devolve o texto que a fixture diz que esta na pagina. Confere a
 * estrategia (OCR quando o modelo nao ve imagem), nao o tesseract.
 */
export function ferramentasDaFixture(f: Fixture): FerramentasDoSistema {
  return {
    renderizar: (_pdf, pagina) =>
      Promise.resolve(new TextEncoder().encode(`pagina:${pagina}`)),
    ocr: (imagem) => {
      const n = Number(/pagina:(\d+)/.exec(new TextDecoder().decode(imagem))?.[1] ?? 1);
      return Promise.resolve(f.ocr?.[n - 1] ?? "");
    },
    decifrarPdf: (pdf, senha) => {
      if (!f.senha || !f.decifrado) return Promise.resolve(pdf);
      if (senha !== f.senha) return Promise.reject(new SenhaIncorreta());
      return Promise.resolve(f.decifrado());
    },
  };
}

export async function executarFixture(
  f: Fixture,
  modelo: LanguageModel,
  o: {
    provedor?: string;
    nome?: string;
    capacidades?: Capacidades;
    armazem?: ArmazemDeImportacao;
    preco?: { entrada: number | null; saida: number | null };
    ferramentas?: FerramentasDoSistema;
    espera_base_ms?: number;
  } = {},
): Promise<ResultadoDaImportacaoComIA> {
  const capacidades = {
    ...(o.capacidades ?? CAPACIDADES_COMPLETAS),
    ...(f.capacidades ?? {}),
  };
  const ferramentas = o.ferramentas ?? ferramentasDaFixture(f);
  let entrada = f.arquivo();
  // PDF com senha: o envio decifra (qpdf) antes de qualquer leitura.
  if (f.senha && "bytes" in entrada && ferramentas.decifrarPdf)
    entrada = {
      ...entrada,
      bytes: await ferramentas.decifrarPdf(entrada.bytes, f.senha),
    };
  const arquivo = await prepararArquivo(entrada, {
    limites: { contexto: capacidades.contexto, max_saida: capacidades.max_saida },
    visao: capacidades.visao,
    ferramentas,
  });
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
    espera_base_ms: o.espera_base_ms ?? 1,
    ...(f.corretora ? { corretora: f.corretora } : {}),
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
