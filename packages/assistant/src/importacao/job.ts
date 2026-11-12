import type { LanguageModel } from "ai";
import type { FerramentasDoSistema } from "./ferramentas.js";
import {
  estimarImportacao,
  prepararArquivo,
  type ArquivoPreparado,
  type Capacidades,
  type Estimativa,
} from "./pipeline.js";
import { ErroDeImportacao, type Limites } from "./recebimento.js";
import {
  importarComIA,
  type ArmazemDeImportacao,
  type Progresso,
  type ResultadoDaImportacaoComIA,
} from "./servico.js";
import type { Verificador } from "./validacao.js";

/**
 * Importacao com IA em segundo plano (ADR 0027). O web cria o job e os arquivos;
 * o worker roda isto. Duas fases: leitura (texto, OCR, estimativa de custo) e
 * extracao. Acima do limite de custo, o job para entre as duas e espera a
 * confirmacao do usuario. A tela acompanha pelo estado gravado (SSE).
 */

export type StatusDoJob =
  "lendo" | "aguardando_confirmacao" | "extraindo" | "pronto" | "falhou" | "cancelado";

export type EstadoDoArquivo =
  | "pendente"
  | "lendo"
  | "ocr"
  | "analisando"
  | "corrigindo"
  | "validando"
  | "pronto"
  | "falhou"
  | "cancelado";

export interface JobDeImportacao {
  id: string;
  status: StatusDoJob;
  aceitou_imagem: boolean;
  confirmado: boolean;
  cancelado: boolean;
}

export interface ArquivoDoJob {
  indice: number;
  nome: string;
  mime: string;
  corretora: string | null;
  dados: Uint8Array | null;
  estado: EstadoDoArquivo;
}

export interface CamposDoArquivo {
  estado?: EstadoDoArquivo;
  progresso?: Progresso | null;
  estrategia?: string;
  estimativa?: Estimativa;
  resultado?: ResultadoDaImportacaoComIA;
  erro?: string | null;
}

/** Onde o job vive (Postgres no worker; memoria no teste). Preso ao usuario. */
export interface RepositorioDeJobs {
  job(): Promise<JobDeImportacao | null>;
  arquivos(): Promise<ArquivoDoJob[]>;
  atualizarJob(c: {
    status?: StatusDoJob;
    estimativa?: unknown;
    erro?: string | null;
  }): Promise<void>;
  atualizarArquivo(indice: number, c: CamposDoArquivo): Promise<void>;
}

export interface AcessoDoJob {
  modelo: LanguageModel;
  provedor: string;
  nome_do_modelo: string;
  preco: { entrada: number | null; saida: number | null };
  capacidades: Capacidades;
  segredos: readonly string[];
  guardar_original: boolean;
}

export interface DependenciasDoJob {
  repo: RepositorioDeJobs;
  acesso: AcessoDoJob;
  armazem: ArmazemDeImportacao;
  verificador: Verificador;
  ferramentas: FerramentasDoSistema;
  hoje: string;
  tolerancia?: number;
  limite_diario: number;
  limites_do_envio?: Limites;
  /** Custo estimado (US$) acima do qual o job espera a confirmacao. */
  confirmar_acima_usd: number;
  concorrencia?: number;
  espera_base_ms?: number;
  /** De quanto em quanto tempo o job confere se foi cancelado. Padrao 2 s. */
  conferir_cancelamento_ms?: number;
  aoErrar?: (detalhe: string) => void;
}

export interface OpcoesDoJob {
  /** Refaz um arquivo: os lotes indicados, ou o arquivo inteiro sem cache. */
  reprocessar?: { indice: number; lotes?: number[] };
}

/** Nao grava progresso mais que duas vezes por segundo por arquivo. */
function limitado(fn: (p: Progresso) => void, ms = 500) {
  let ultimo = 0;
  return (p: Progresso) => {
    const agora = Date.now();
    if (agora - ultimo < ms && p.etapa === "analisando") return;
    ultimo = agora;
    fn(p);
  };
}

const mensagem = (erro: unknown) =>
  erro instanceof ErroDeImportacao
    ? erro.message
    : "Não foi possível processar este arquivo. Tente de novo; se continuar, use outro modelo.";

export async function executarJob(
  d: DependenciasDoJob,
  o: OpcoesDoJob = {},
): Promise<void> {
  const job = await d.repo.job();
  if (!job || job.cancelado) return;
  const arquivos = (await d.repo.arquivos()).filter(
    (a) => a.dados && (o.reprocessar ? a.indice === o.reprocessar.indice : true),
  );

  // ------------------------------------------------------------ leitura
  const preparados = new Map<number, ArquivoPreparado>();
  let total: number | null = 0;
  for (const a of arquivos) {
    await d.repo.atualizarArquivo(a.indice, {
      estado: "lendo",
      progresso: { etapa: "lendo" },
      erro: null,
    });
    try {
      const p = await prepararArquivo(
        { nome: a.nome, mime: a.mime, bytes: a.dados as Uint8Array },
        {
          limites: {
            contexto: d.acesso.capacidades.contexto,
            max_saida: d.acesso.capacidades.max_saida,
          },
          visao: d.acesso.capacidades.visao,
          ferramentas: d.ferramentas,
          ...(d.limites_do_envio ? { limites_do_envio: d.limites_do_envio } : {}),
        },
      );
      const estimativa = estimarImportacao(
        p,
        d.acesso.preco,
        d.acesso.capacidades.max_saida,
      );
      preparados.set(a.indice, p);
      total =
        total === null || estimativa.custo_estimado === null
          ? null
          : total + Number(estimativa.custo_estimado);
      await d.repo.atualizarArquivo(a.indice, {
        estado: "pendente",
        estrategia: p.estrategia,
        estimativa,
        progresso:
          p.ocr.length > 0
            ? { etapa: "ocr", feitos: p.ocr.length, total: p.ocr.length }
            : null,
      });
    } catch (erro) {
      d.aoErrar?.(`leitura de ${a.nome}: ${(erro as Error).message}`);
      await d.repo.atualizarArquivo(a.indice, {
        estado: "falhou",
        erro: mensagem(erro),
        progresso: null,
      });
    }
  }
  if (preparados.size === 0) {
    await d.repo.atualizarJob({ status: arquivos.length ? "falhou" : "pronto" });
    return;
  }
  const estimativa = { custo_estimado: total === null ? null : total.toFixed(6) };
  if (
    !job.confirmado &&
    !o.reprocessar &&
    total !== null &&
    total > d.confirmar_acima_usd
  ) {
    await d.repo.atualizarJob({ status: "aguardando_confirmacao", estimativa });
    return;
  }

  // ------------------------------------------------------------ extracao
  await d.repo.atualizarJob({ status: "extraindo", estimativa });
  let cancelado = false;
  for (const a of arquivos) {
    const p = preparados.get(a.indice);
    if (!p || cancelado) continue;
    const controle = new AbortController();
    const vigia = setInterval(() => {
      void d.repo.job().then((j) => {
        if (j?.cancelado) {
          cancelado = true;
          controle.abort();
        }
      });
    }, d.conferir_cancelamento_ms ?? 2_000);
    // Progresso em fila: gravacao solta pode chegar depois do "pronto" e
    // sobrescreve-lo, e o arquivo fica preso em "Conciliando".
    let progresso: Promise<unknown> = Promise.resolve();
    const avancar = limitado((x) => {
      const estado: EstadoDoArquivo =
        x.etapa === "corrigindo"
          ? "corrigindo"
          : x.etapa === "validando"
            ? "validando"
            : "analisando";
      progresso = progresso
        .then(() => d.repo.atualizarArquivo(a.indice, { estado, progresso: x }))
        .catch(() => undefined);
    });
    try {
      const resultado = await importarComIA({
        arquivo: p,
        original: d.acesso.guardar_original
          ? { mime: a.mime, dados: a.dados as Uint8Array }
          : null,
        modelo: d.acesso.modelo,
        provedor: d.acesso.provedor,
        nome_do_modelo: d.acesso.nome_do_modelo,
        preco: d.acesso.preco,
        capacidades: d.acesso.capacidades,
        armazem: d.armazem,
        verificador: d.verificador,
        hoje: d.hoje,
        limite_diario: d.limite_diario,
        aceitou_enviar_imagem: job.aceitou_imagem,
        segredos: d.acesso.segredos,
        abortar: controle.signal,
        aoAvancar: avancar,
        ...(a.corretora ? { corretora: a.corretora } : {}),
        ...(d.tolerancia === undefined ? {} : { tolerancia: d.tolerancia }),
        ...(d.concorrencia ? { concorrencia: d.concorrencia } : {}),
        ...(d.espera_base_ms !== undefined ? { espera_base_ms: d.espera_base_ms } : {}),
        ...(d.aoErrar ? { aoErrar: d.aoErrar } : {}),
        ...(o.reprocessar?.lotes
          ? { reprocessar_lotes: o.reprocessar.lotes }
          : o.reprocessar
            ? { reprocessar: true }
            : {}),
      });
      await progresso;
      await d.repo.atualizarArquivo(a.indice, {
        estado: cancelado ? "cancelado" : "pronto",
        resultado,
        progresso: null,
        erro: null,
      });
    } catch (erro) {
      d.aoErrar?.(`extração de ${a.nome}: ${(erro as Error).message}`);
      await progresso;
      await d.repo.atualizarArquivo(a.indice, {
        estado: cancelado ? "cancelado" : "falhou",
        erro: cancelado ? "Cancelado." : mensagem(erro),
        progresso: null,
      });
    } finally {
      clearInterval(vigia);
    }
  }
  await d.repo.atualizarJob({ status: cancelado ? "cancelado" : "pronto" });
}
