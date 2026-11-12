import type { LanguageModel } from "ai";
import {
  COLUNAS_BOLSIQ,
  COLUNAS_POSICAO,
  dividirCsv,
  detectarSeparador,
} from "@bolsiq/portfolio";
import { custoEstimado, type Uso } from "../orcamento.js";
import { VERSAO_DO_PROMPT_DE_IMPORTACAO } from "../../prompts/importacao-v1.js";
import {
  SaidaDaIA,
  saidaVazia,
  type PosicaoDaIA,
  type TransacaoDaIA,
} from "./esquema.js";
import {
  corrigirLinhas,
  extrairComIA,
  juntarSaidas,
  pedidosDeLinhas,
} from "./extracao.js";
import type { ArquivoPreparado, Capacidades } from "./pipeline.js";
import { ErroDeImportacao } from "./recebimento.js";
import type { SaidaDasLinhas } from "./saida-csv.js";
import type { Estrategia, Parte, TabelaNoLayout } from "./texto.js";
import {
  validarExtracao,
  type ParaCorrigir,
  type ResultadoDaValidacao,
  type Verificador,
} from "./validacao.js";

export interface ChaveDoCache {
  hash: string;
  versao_prompt: string;
  provedor: string;
  modelo: string;
}

export interface ExtracaoGuardada {
  id: string;
  saida: unknown;
}

/** Onde o BFF (ou o worker) guarda cache e consumo. Preso ao usuario, como as `Fontes`. */
export interface ArmazemDeImportacao {
  buscar(chave: ChaveDoCache): Promise<ExtracaoGuardada | null>;
  /** Importacoes que chamaram o provedor hoje (cache nao conta). */
  feitasHoje(): Promise<number>;
  gravar(registro: {
    chave: ChaveDoCache;
    nome_arquivo: string;
    tipo_arquivo: string;
    saida: SaidaDaIA;
    relatorio: ResultadoDaValidacao;
    uso: Uso;
    custo_estimado: string | null;
    original: { mime: string; dados: Uint8Array } | null;
  }): Promise<string>;
  atualizarRelatorio(id: string, relatorio: ResultadoDaValidacao): Promise<void>;
  registrarUso(uso: Uso, custo: string | null): Promise<void>;
}

/** Etapas que a tela mostra: lendo, OCR, IA lote n/N, corrigindo, conciliando. */
export type Etapa = "lendo" | "ocr" | "analisando" | "corrigindo" | "validando";

export interface Progresso {
  etapa: Etapa;
  feitos?: number;
  total?: number;
  linhas?: number;
}

/** Rodadas de autocorrecao antes de mostrar ao usuario. */
export const RODADAS_DE_CORRECAO = 2;

export interface PedidoDeImportacao {
  arquivo: ArquivoPreparado;
  /** O arquivo como chegou: so e guardado com `guardar_original`. */
  original: { mime: string; dados: Uint8Array } | null;
  modelo: LanguageModel;
  provedor: string;
  nome_do_modelo: string;
  preco: { entrada: number | null; saida: number | null };
  capacidades: Capacidades;
  armazem: ArmazemDeImportacao;
  verificador: Verificador;
  hoje: string;
  tolerancia?: number;
  limite_diario: number;
  /** Corretora escolhida no envio deste arquivo, para a politica de preenchimento. */
  corretora?: string;
  /** Ignora o cache: outra tentativa com o mesmo modelo. */
  reprocessar?: boolean;
  /** Refaz so estes lotes, mantendo o resto da extracao guardada. */
  reprocessar_lotes?: number[];
  /** Imagem e pagina escaneada vao sem anonimizacao: o usuario precisa aceitar. */
  aceitou_enviar_imagem?: boolean;
  concorrencia?: number;
  espera_base_ms?: number;
  segredos: readonly string[];
  aoAvancar?: (p: Progresso) => void;
  /** Detalhe tecnico das falhas do provedor, ja limpo, para o log. */
  aoErrar?: (detalhe: string) => void;
  abortar?: AbortSignal;
}

export interface ResultadoDaImportacaoComIA {
  extracao_id: string;
  do_cache: boolean;
  provedor: string;
  modelo: string;
  versao_prompt: string;
  uso: Uso;
  /** Desta chamada: zero quando veio do cache. */
  custo_estimado: string | null;
  arquivo: { nome: string; tipo: string; hash: string; paginas: number };
  estrategia: Estrategia;
  remocoes: ArquivoPreparado["remocoes"];
  /** Texto anonimizado de cada pagina ou aba, para a tela mostrar a origem. */
  partes: Parte[];
  /** Lotes que falharam: a revisao oferece "reprocessar lote". */
  lotes_falhos: SaidaDaIA["lotes_falhos"];
  /** Rodadas de autocorrecao feitas e linhas recuperadas por elas. */
  correcao: { rodadas: number; recuperadas: number };
  validacao: ResultadoDaValidacao;
}

// ---------------------------------------------------------------------------
// Abas no layout do Bolsiq, sem IA
// ---------------------------------------------------------------------------

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function linhasDaTabela(t: TabelaNoLayout) {
  const brutas = t.conteudo.split(/\r?\n/).filter((l) => l.trim());
  const separador = detectarSeparador(brutas[0] ?? "");
  return {
    cabecalho: dividirCsv(brutas[0] ?? "", separador).map((c) => semAcento(c.trim())),
    linhas: brutas
      .slice(1)
      .map((texto) => ({ texto, campos: dividirCsv(texto, separador) })),
  };
}

/**
 * Aba ja no layout canonico vira linhas sem passar pela IA: o trecho de origem e
 * a propria linha da aba, e a confianca e alta. Entram na mesma validacao e na
 * mesma revisao das linhas da IA.
 */
export function linhasDoLayout(tabelas: TabelaNoLayout[]): SaidaDasLinhas {
  const r: SaidaDasLinhas = {
    posicoes: [],
    transacoes: [],
    proventos: [],
    notas: [],
    malformadas: [],
  };
  for (const t of tabelas) {
    const { cabecalho, linhas } = linhasDaTabela(t);
    const col = (nomes: string[]) => {
      for (const n of nomes) {
        const i = cabecalho.findIndex((c) => c === n || c.includes(n));
        if (i !== -1) return i;
      }
      return -1;
    };
    for (const l of linhas) {
      const origem = { pagina_ou_aba: t.origem, trecho_original: l.texto.slice(0, 200) };
      const v = (i: number) => (i === -1 ? "" : (l.campos[i] ?? "").trim());
      if (t.atalho === "posicao_bolsiq") {
        r.posicoes.push({
          ...(Object.fromEntries(
            COLUNAS_POSICAO.map((c) => [c, v(cabecalho.indexOf(c))]),
          ) as Omit<PosicaoDaIA, "origem" | "confianca">),
          origem,
          confianca: "alta",
        });
      } else if (t.atalho === "bolsiq") {
        r.transacoes.push({
          ...(Object.fromEntries(
            COLUNAS_BOLSIQ.map((c) => [c, v(cabecalho.indexOf(c))]),
          ) as Omit<
            TransacaoDaIA,
            "origem" | "confianca" | "ativo_no_documento" | "nota"
          >),
          ativo_no_documento: "",
          nota: "",
          origem,
          confianca: "alta",
        });
      } else {
        // Extrato de negociacao da B3: as colunas da Area do Investidor.
        const tipo = semAcento(v(col(["tipo de movimentacao", "movimentacao", "tipo"])));
        r.transacoes.push({
          data: v(col(["data do negocio", "data"])),
          ticker: v(col(["codigo de negociacao", "codigo", "ticker"])),
          tipo: tipo.startsWith("c") ? "compra" : tipo.startsWith("v") ? "venda" : tipo,
          quantidade: v(col(["quantidade"])),
          preco: v(col(["preco unitario", "preco"])),
          taxas: "",
          corretora: v(col(["instituicao"])),
          ativo_no_documento: "",
          nota: "",
          origem,
          confianca: "alta",
        });
      }
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Autocorrecao
// ---------------------------------------------------------------------------

const compactar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** A corrigida corresponde a recusada: mesma pagina e mesmo trecho, ou mesmo ativo. */
function corresponde(
  r: ParaCorrigir,
  c: { origem: { pagina_ou_aba: string; trecho_original: string } } & Record<
    string,
    unknown
  >,
): boolean {
  const o = r.original as unknown as Record<string, string> & {
    origem: { pagina_ou_aba: string; trecho_original: string };
  };
  if (compactar(o.origem.pagina_ou_aba) !== compactar(c.origem.pagina_ou_aba))
    return false;
  if (compactar(o.origem.trecho_original) === compactar(c.origem.trecho_original))
    return true;
  const ativo = (x: Record<string, unknown>) => {
    const v = [x.codigo, x.ticker, x.ativo].find(
      (y) => typeof y === "string" && y !== "",
    );
    return compactar(typeof v === "string" ? v : "");
  };
  return ativo(o) !== "" && ativo(o) === ativo(c);
}

/**
 * Poe as corrigidas no lugar das recusadas. Recusada que nao voltou fica como
 * estava (e continua recusada ou em ajuste): o modelo nao tira linha da revisao.
 */
function substituir(
  saida: SaidaDaIA,
  recusadas: ParaCorrigir[],
  corrigidas: SaidaDasLinhas,
): SaidaDaIA {
  const todas = [
    ...corrigidas.posicoes,
    ...corrigidas.transacoes,
    ...corrigidas.proventos,
  ] as unknown as ({
    origem: { pagina_ou_aba: string; trecho_original: string };
  } & Record<string, unknown>)[];
  const fora = new Set<object>(
    recusadas.filter((r) => todas.some((c) => corresponde(r, c))).map((r) => r.original),
  );
  // Linha nova que nao corresponde a nenhuma recusada nao entra: a autocorrecao
  // so conserta, nao acrescenta.
  const tipo: Record<string, ParaCorrigir["tipo"]> = {
    posicoes: "posicao",
    transacoes: "transacao",
    proventos: "provento",
  };
  const valida = (chave: string) => (c: unknown) =>
    recusadas.some(
      (r) =>
        r.tipo === tipo[chave] && corresponde(r, c as Parameters<typeof corresponde>[1]),
    );
  return {
    ...saida,
    posicoes: [
      ...saida.posicoes.filter((x) => !fora.has(x)),
      ...corrigidas.posicoes.filter(valida("posicoes")),
    ],
    transacoes: [
      ...saida.transacoes.filter((x) => !fora.has(x)),
      ...corrigidas.transacoes.filter(valida("transacoes")),
    ],
    proventos: [
      ...saida.proventos.filter((x) => !fora.has(x)),
      ...corrigidas.proventos.filter(valida("proventos")),
    ],
    malformadas: [...saida.malformadas, ...corrigidas.malformadas],
  };
}

const daOrigem = (origens: Set<string>) => (x: { origem: { pagina_ou_aba: string } }) =>
  origens.has(x.origem.pagina_ou_aba.toLowerCase());

// ---------------------------------------------------------------------------
// Importacao
// ---------------------------------------------------------------------------

/**
 * Do arquivo preparado a proposta revisavel. A IA so propoe: nada aqui grava
 * posicao nem transacao, so o cache e o consumo. Ordem: extracao (cabecalho e
 * lotes), abas no layout (sem IA), validacao, ate duas rodadas de autocorrecao
 * com as linhas recusadas, e a validacao final que vai para a revisao.
 */
export async function importarComIA(
  p: PedidoDeImportacao,
): Promise<ResultadoDaImportacaoComIA> {
  const a = p.arquivo;
  if (a.atalho)
    throw new ErroDeImportacao(
      "atalho",
      `${a.nome} já está no layout ${a.atalho}: vai pela importação sem IA.`,
      409,
    );
  if ((a.imagens.length > 0 || a.arquivo_para_visao) && !p.aceitou_enviar_imagem)
    throw new ErroDeImportacao(
      "imagem_sem_aceite",
      "Páginas escaneadas vão ao provedor como imagem, sem anonimização. Confirme o envio para continuar.",
      409,
    );

  const chave: ChaveDoCache = {
    hash: a.hash,
    versao_prompt: VERSAO_DO_PROMPT_DE_IMPORTACAO,
    provedor: p.provedor,
    modelo: p.nome_do_modelo,
  };
  const guardada =
    p.reprocessar && !p.reprocessar_lotes ? null : await p.armazem.buscar(chave);
  const lida = guardada ? SaidaDaIA.safeParse(guardada.saida) : null;
  const anterior = lida?.success ? lida.data : null;
  const doCache = anterior !== null && !p.reprocessar_lotes;
  const precisaDaIA = pedidosDeLinhas(a).length > 0;

  const uso: Uso = { tokens_entrada: 0, tokens_saida: 0 };
  const pedido = {
    modelo: p.modelo,
    lotes: a.lotes,
    partes: a.partes,
    imagens: a.imagens,
    arquivo_para_visao: a.arquivo_para_visao,
    sem_texto: a.sem_texto,
    maxSaida: p.capacidades.max_saida,
    estruturada: p.capacidades.saida_estruturada,
    segredos: p.segredos,
    ...(p.concorrencia ? { concorrencia: p.concorrencia } : {}),
    ...(p.espera_base_ms !== undefined ? { espera_base_ms: p.espera_base_ms } : {}),
    ...(p.aoErrar ? { aoErrar: p.aoErrar } : {}),
    ...(p.abortar ? { abortar: p.abortar } : {}),
    aoProgredir: (feitos: number, total: number, linhas: number) =>
      p.aoAvancar?.({ etapa: "analisando", feitos, total, linhas }),
  };

  let saida: SaidaDaIA;
  let chamouProvedor = false;
  try {
    if (doCache && anterior) {
      saida = anterior;
    } else {
      if (precisaDaIA) {
        if ((await p.armazem.feitasHoje()) >= p.limite_diario)
          throw new ErroDeImportacao(
            "limite_diario",
            `Você chegou ao limite de ${p.limite_diario} importações com IA por dia. O limite volta amanhã.`,
            429,
          );
        chamouProvedor = true;
      }
      if (p.reprocessar_lotes && anterior) {
        // So os lotes pedidos: o resto da extracao guardada fica.
        const r = await extrairComIA({
          ...pedido,
          apenas: p.reprocessar_lotes,
          cabecalho: { ...anterior.documento, avisos: [] },
        });
        Object.assign(uso, r.uso);
        const origens = new Set(
          pedidosDeLinhas(a)
            .filter((_, i) => p.reprocessar_lotes?.includes(i))
            .flatMap((x) => x.origens.map((o) => o.toLowerCase())),
        );
        const fora = daOrigem(origens);
        saida = {
          ...anterior,
          posicoes: [...anterior.posicoes.filter((x) => !fora(x)), ...r.saida.posicoes],
          transacoes: [
            ...anterior.transacoes.filter((x) => !fora(x)),
            ...r.saida.transacoes,
          ],
          proventos: [
            ...anterior.proventos.filter((x) => !fora(x)),
            ...r.saida.proventos,
          ],
          lotes_falhos: [
            ...anterior.lotes_falhos.filter(
              (l) => !p.reprocessar_lotes?.includes(l.indice),
            ),
            ...r.saida.lotes_falhos,
          ],
        };
      } else {
        saida = saidaVazia();
        if (precisaDaIA) {
          const r = await extrairComIA(pedido);
          Object.assign(uso, r.uso);
          saida = r.saida;
        }
        // Abas no layout do Bolsiq entram sem IA, com o trecho sendo a propria linha.
        const doLayout = linhasDoLayout(a.no_layout);
        const juntas = juntarSaidas([
          saida,
          { ...saidaVazia(), ...doLayout, documento: saida.documento },
        ]);
        saida = {
          ...juntas,
          documento: saida.documento,
          lotes_falhos: saida.lotes_falhos,
        };
      }
    }
  } catch (erro) {
    // Token gasto numa extracao que falhou tambem e custo do usuario.
    if (erro instanceof ErroDeImportacao && erro.uso)
      await p.armazem.registrarUso(erro.uso, custoEstimado(erro.uso, p.preco));
    throw erro;
  }

  const fontes: Parte[] = [
    ...a.partes,
    ...a.no_layout.map((t) => ({ origem: t.origem, texto: t.conteudo })),
  ];
  const validar = (s: SaidaDaIA) =>
    validarExtracao(s, fontes, p.verificador, {
      hoje: p.hoje,
      sem_texto: a.sem_texto,
      preenchimento: { corretora_escolhida: p.corretora ?? "", nome_do_arquivo: a.nome },
      ...(p.tolerancia === undefined ? {} : { tolerancia: p.tolerancia }),
    });

  p.aoAvancar?.({ etapa: "validando" });
  let validacao = await validar(saida);
  let rodadas = 0;
  const antes = validacao.para_corrigir.length;
  if (!doCache && chamouProvedor)
    while (rodadas < RODADAS_DE_CORRECAO && validacao.para_corrigir.length > 0) {
      if (p.abortar?.aborted) break;
      rodadas++;
      p.aoAvancar?.({ etapa: "corrigindo", feitos: rodadas, total: RODADAS_DE_CORRECAO });
      try {
        const corrigidas = await corrigirLinhas(pedido, validacao.para_corrigir, uso);
        saida = substituir(saida, validacao.para_corrigir, corrigidas);
      } catch (erro) {
        // Autocorrecao e melhoria: se o provedor falhar, segue com o que ha.
        p.aoErrar?.(`autocorreção: ${(erro as Error).message}`);
        break;
      }
      validacao = await validar(saida);
    }
  const recuperadas = Math.max(0, antes - validacao.para_corrigir.length);

  const custo = chamouProvedor ? custoEstimado(uso, p.preco) : "0.000000";
  if (chamouProvedor) await p.armazem.registrarUso(uso, custo);

  let id: string;
  if (guardada && doCache) {
    id = guardada.id;
    await p.armazem.atualizarRelatorio(id, validacao);
  } else {
    id = await p.armazem.gravar({
      chave,
      nome_arquivo: a.nome,
      tipo_arquivo: a.tipo,
      saida,
      relatorio: validacao,
      uso,
      custo_estimado: custo,
      original: p.original,
    });
  }

  return {
    extracao_id: id,
    do_cache: doCache,
    provedor: p.provedor,
    modelo: p.nome_do_modelo,
    versao_prompt: VERSAO_DO_PROMPT_DE_IMPORTACAO,
    uso,
    custo_estimado: custo,
    arquivo: { nome: a.nome, tipo: a.tipo, hash: a.hash, paginas: a.paginas },
    estrategia: a.estrategia,
    remocoes: a.remocoes,
    partes: fontes,
    lotes_falhos: saida.lotes_falhos,
    correcao: { rodadas, recuperadas },
    validacao,
  };
}
