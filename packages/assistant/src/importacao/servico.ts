import type { LanguageModel } from "ai";
import { custoEstimado, type Uso } from "../orcamento.js";
import { VERSAO_DO_PROMPT_DE_IMPORTACAO } from "../../prompts/importacao-v1.js";
import { SaidaDaIA } from "./esquema.js";
import { extrairComIA } from "./extracao.js";
import {
  conferirCapacidades,
  type ArquivoPreparado,
  type Capacidades,
} from "./pipeline.js";
import { ErroDeImportacao } from "./recebimento.js";
import type { Parte } from "./texto.js";
import {
  validarExtracao,
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

/** Onde o BFF guarda cache e consumo. Preso ao usuario da sessao, como as `Fontes`. */
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

export type Etapa = "extraindo" | "analisando" | "validando";

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
  /** Ignora o cache: outra tentativa com o mesmo modelo. */
  reprocessar?: boolean;
  /** Imagem e PDF escaneado vao sem anonimizacao: o usuario precisa aceitar. */
  aceitou_enviar_imagem?: boolean;
  segredos: readonly string[];
  aoAvancar?: (etapa: Etapa, detalhe?: string) => void;
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
  remocoes: ArquivoPreparado["remocoes"];
  /** Texto anonimizado de cada pagina ou aba, para a tela mostrar a origem. */
  partes: Parte[];
  validacao: ResultadoDaValidacao;
}

/**
 * Do arquivo preparado a proposta revisavel. A IA so propoe: nada aqui grava
 * posicao nem transacao, so o cache e o consumo.
 */
export async function importarComIA(
  p: PedidoDeImportacao,
): Promise<ResultadoDaImportacaoComIA> {
  const a = p.arquivo;
  if (a.atalho)
    throw new ErroDeImportacao(
      "atalho",
      `${a.nome} já está no layout ${a.atalho}: use a importação sem IA.`,
      409,
    );
  conferirCapacidades(a, p.capacidades);
  if (a.arquivo_para_visao && !p.aceitou_enviar_imagem)
    throw new ErroDeImportacao(
      "imagem_sem_aceite",
      "Imagem e página escaneada vão ao provedor sem anonimização. Confirme o envio para continuar.",
      409,
    );

  const chave: ChaveDoCache = {
    hash: a.hash,
    versao_prompt: VERSAO_DO_PROMPT_DE_IMPORTACAO,
    provedor: p.provedor,
    modelo: p.nome_do_modelo,
  };
  const guardada = p.reprocessar ? null : await p.armazem.buscar(chave);
  const doCache = guardada ? SaidaDaIA.safeParse(guardada.saida) : null;

  let saida: SaidaDaIA;
  let uso: Uso = { tokens_entrada: 0, tokens_saida: 0 };
  let custo: string | null = "0.000000";
  if (doCache?.success) {
    saida = doCache.data;
  } else {
    if ((await p.armazem.feitasHoje()) >= p.limite_diario)
      throw new ErroDeImportacao(
        "limite_diario",
        `Você chegou ao limite de ${p.limite_diario} importações com IA por dia.`,
        429,
      );
    p.aoAvancar?.("analisando");
    try {
      const r = await extrairComIA({
        modelo: p.modelo,
        lotes: a.lotes,
        arquivo_para_visao: a.arquivo_para_visao,
        sem_texto: a.sem_texto,
        maxSaida: p.capacidades.max_saida,
        segredos: p.segredos,
        aoProgredir: (feitas, total) =>
          total > 1 &&
          feitas < total &&
          p.aoAvancar?.("analisando", `parte ${feitas + 1} de ${total}`),
        ...(p.abortar ? { abortar: p.abortar } : {}),
      });
      saida = r.saida;
      uso = r.uso;
    } catch (erro) {
      // Token gasto numa extracao que falhou tambem e custo do usuario.
      if (erro instanceof ErroDeImportacao && erro.uso)
        await p.armazem.registrarUso(erro.uso, custoEstimado(erro.uso, p.preco));
      throw erro;
    }
    custo = custoEstimado(uso, p.preco);
    await p.armazem.registrarUso(uso, custo);
  }

  p.aoAvancar?.("validando");
  const validacao = await validarExtracao(saida, a.partes, p.verificador, {
    hoje: p.hoje,
    sem_texto: a.sem_texto,
    ...(p.tolerancia === undefined ? {} : { tolerancia: p.tolerancia }),
  });

  let id: string;
  if (guardada && doCache?.success) {
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
    do_cache: Boolean(doCache?.success),
    provedor: p.provedor,
    modelo: p.nome_do_modelo,
    versao_prompt: VERSAO_DO_PROMPT_DE_IMPORTACAO,
    uso,
    custo_estimado: custo,
    arquivo: { nome: a.nome, tipo: a.tipo, hash: a.hash, paginas: a.paginas },
    remocoes: a.remocoes,
    partes: a.partes,
    validacao,
  };
}
