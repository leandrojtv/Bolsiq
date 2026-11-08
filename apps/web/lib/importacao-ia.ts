import "server-only";
import { randomUUID } from "node:crypto";
import { and, count, eq, gte, sql } from "drizzle-orm";
import {
  capacidadesDoModelo,
  criarModelo,
  csvDePosicoes,
  csvDeTransacoes,
  decifrarChave,
  ErroDeImportacao,
  estimarImportacao,
  importarComIA,
  modelosParaImportar,
  prepararArquivo,
  registroDoModelo,
  schema,
  validarLinhasEditadas,
  VERSAO_DO_PROMPT_DE_IMPORTACAO,
  type ArmazemDeImportacao,
  type ArquivoPreparado,
  type Entrada,
  type Etapa,
  type Provedor,
  type ResultadoDaValidacao,
  type Verificador,
} from "@bolsiq/assistant";
import type { Candle } from "@bolsiq/contracts";
import {
  COLUNAS_BOLSIQ,
  COLUNAS_POSICAO,
  comoUsuario,
  type RevisaoDeCarga,
} from "@bolsiq/portfolio";
import { banco } from "./analytics";
import {
  baseDoProvedor,
  ErroDoAssistente,
  inicioDoDia,
  mestra,
  registrarErro,
} from "./assistente";
import {
  importar,
  importarPosicao,
  revisarPosicao,
  type RelatorioNaTela,
} from "./carteira";
import { env } from "./env";
import type {
  EstadoDaImportacaoIA,
  EstimativaDoArquivo,
  LinhaEditada,
  PedidoDeConfirmacaoIA,
  ResultadoNaTela,
} from "./importacao-ia-modelo";
import { hojeEmSp } from "./indicadores-tecnicos";
import { buscarV1, VALIDADE } from "./market-data";

const { settings, usage, extractions } = schema;

/**
 * Importacao com IA (ADR 0026). A IA so propoe linhas: a gravacao e a mesma do
 * CSV de posicoes e do CSV de transacoes, e so acontece na confirmacao.
 */

const lerSettings = (uid: string) =>
  comoUsuario(banco(), uid, async (tx) => {
    const [s] = await tx.select().from(settings).where(eq(settings.user_id, uid));
    return s ?? null;
  });

const contarHoje = (uid: string) =>
  comoUsuario(banco(), uid, async (tx) => {
    const [n] = await tx
      .select({ n: count() })
      .from(usage)
      .where(
        and(
          eq(usage.user_id, uid),
          gte(usage.criado_em, inicioDoDia()),
          eq(usage.origem, "importacao"),
        ),
      );
    return n?.n ?? 0;
  });

export async function estadoDaImportacaoIA(uid: string): Promise<EstadoDaImportacaoIA> {
  const [s, feitas] = await Promise.all([lerSettings(uid), contarHoje(uid)]);
  const provedor = (s?.provedor ?? null) as Provedor | null;
  const modelo = s?.modelo ?? null;
  const c = provedor && modelo ? capacidadesDoModelo(provedor, modelo) : null;
  return {
    configurado: Boolean(provedor && modelo),
    provedor,
    modelo,
    // Basta texto: as linhas vem em CSV (ADR 0026, Revisao).
    pode_importar: c !== null,
    visao: c?.visao ?? false,
    consentiu: Boolean(s?.consentimento_importacao_em),
    guardar_original: s?.guardar_original ?? false,
    limite_diario: env.ASSISTANT_IMPORT_DAILY,
    feitas_hoje: feitas,
    modelos: provedor ? modelosParaImportar(provedor) : [],
  };
}

export async function registrarConsentimentoDaImportacao(
  uid: string,
  guardarOriginal: boolean,
): Promise<void> {
  await comoUsuario(banco(), uid, (tx) =>
    tx
      .insert(settings)
      .values({
        user_id: uid,
        consentimento_importacao_em: sql`now()`,
        guardar_original: guardarOriginal,
      })
      .onConflictDoUpdate({
        target: settings.user_id,
        set: {
          consentimento_importacao_em: sql`now()`,
          guardar_original: guardarOriginal,
          atualizado_em: sql`now()`,
        },
      }),
  );
}

interface Acesso {
  provedor: Provedor;
  modelo: string;
  chave: string | null;
  baseUrl: string | null;
  preco: { entrada: number | null; saida: number | null };
  capacidades: ReturnType<typeof capacidadesDoModelo>;
  guardar_original: boolean;
}

/**
 * Chave e modelo do usuario, a mesma configuracao do assistente. Outro modelo so
 * do mesmo provedor e da lista com saida estruturada: e a mesma chave.
 */
async function acessoParaImportar(uid: string, outroModelo?: string): Promise<Acesso> {
  const s = await lerSettings(uid);
  if (!s?.provedor || !s.modelo)
    throw new ErroDoAssistente(
      409,
      "nao_configurado",
      "Configure um modelo em Configurações do assistente para importar com IA.",
    );
  if (!s.consentimento_importacao_em)
    throw new ErroDoAssistente(
      409,
      "consentimento",
      "Confirme o envio do documento ao provedor antes da primeira importação com IA.",
    );
  const provedor = s.provedor as Provedor;
  const modelo = outroModelo || s.modelo;
  if (outroModelo && !modelosParaImportar(provedor).some((m) => m.modelo === outroModelo))
    throw new ErroDoAssistente(
      422,
      "modelo_invalido",
      "Modelo fora da lista de importação.",
    );
  const registro = registroDoModelo(provedor, modelo);
  const mesmo = modelo === s.modelo;
  return {
    provedor,
    modelo,
    chave: s.chave_cifrada ? decifrarChave(s.chave_cifrada, mestra(), uid) : null,
    baseUrl: baseDoProvedor(provedor, s.base_url),
    preco: {
      entrada:
        mesmo && s.preco_entrada !== null
          ? Number(s.preco_entrada)
          : (registro?.preco_entrada ?? null),
      saida:
        mesmo && s.preco_saida !== null
          ? Number(s.preco_saida)
          : (registro?.preco_saida ?? null),
    },
    capacidades: capacidadesDoModelo(provedor, modelo),
    guardar_original: s.guardar_original,
  };
}

/** Cache e consumo no schema `assistant`, preso ao usuario pela RLS. */
function armazemDoUsuario(
  uid: string,
  provedor: string,
  modelo: string,
): ArmazemDeImportacao {
  const db = banco();
  return {
    buscar: (c) =>
      comoUsuario(db, uid, async (tx) => {
        const [l] = await tx
          .select({ id: extractions.id, saida: extractions.extraido })
          .from(extractions)
          .where(
            and(
              eq(extractions.user_id, uid),
              eq(extractions.hash, c.hash),
              eq(extractions.versao_prompt, c.versao_prompt),
              eq(extractions.provedor, c.provedor),
              eq(extractions.modelo, c.modelo),
            ),
          );
        return l ?? null;
      }),
    feitasHoje: () => contarHoje(uid),
    gravar: (r) =>
      comoUsuario(db, uid, async (tx) => {
        const valores = {
          extraido: r.saida,
          relatorio: r.relatorio,
          tokens_entrada: r.uso.tokens_entrada,
          tokens_saida: r.uso.tokens_saida,
          custo_estimado: r.custo_estimado,
          original: r.original ? Buffer.from(r.original.dados) : null,
          original_mime: r.original?.mime ?? null,
          nome_arquivo: r.nome_arquivo.slice(0, 200),
          tipo_arquivo: r.tipo_arquivo,
          confirmado_em: null,
        };
        // Reprocessar o mesmo arquivo com o mesmo modelo substitui a extracao.
        const [l] = await tx
          .insert(extractions)
          .values({
            id: randomUUID(),
            user_id: uid,
            hash: r.chave.hash,
            versao_prompt: r.chave.versao_prompt,
            provedor: r.chave.provedor,
            modelo: r.chave.modelo,
            ...valores,
          })
          .onConflictDoUpdate({
            target: [
              extractions.user_id,
              extractions.hash,
              extractions.versao_prompt,
              extractions.provedor,
              extractions.modelo,
            ],
            set: { ...valores, criado_em: sql`now()` },
          })
          .returning({ id: extractions.id });
        return (l as { id: string }).id;
      }),
    atualizarRelatorio: (id, relatorio) =>
      comoUsuario(db, uid, async (tx) => {
        await tx.update(extractions).set({ relatorio }).where(eq(extractions.id, id));
      }),
    registrarUso: (uso, custo) =>
      comoUsuario(db, uid, async (tx) => {
        await tx.insert(usage).values({
          id: randomUUID(),
          user_id: uid,
          conversation_id: null,
          provedor,
          modelo,
          plataforma: false,
          origem: "importacao",
          tokens_entrada: uso.tokens_entrada,
          tokens_saida: uso.tokens_saida,
          custo_estimado: custo,
        });
      }),
  };
}

/**
 * O que o market-data sabe: ticker existe (`/v1/assets/:t`) e minima e maxima do
 * pregao (`/v1/history`, sem ajuste, que e o preco negociado).
 */
export function verificadorDoMarketData(): Verificador {
  return {
    async tickersExistentes(tickers) {
      const r = await Promise.all(
        tickers.map(async (t) => {
          if (!/^[A-Z0-9]{4,12}$/.test(t)) return [t, 404] as const;
          const x = await buscarV1<unknown>(`assets/${t}`, VALIDADE.assets);
          return [t, x.status] as const;
        }),
      );
      if (r.some(([, s]) => s !== 200 && s !== 404)) return null;
      return new Set(r.filter(([, s]) => s === 200).map(([t]) => t));
    },
    async faixaDoDia(ticker, data) {
      const r = await buscarV1<{ data: { candles: Candle[] } }>(
        `history/${ticker}?interval=1d&from=${data}&to=${data}&adjusted=false`,
        VALIDADE.history,
      );
      const c =
        r.status === 200 ? r.corpo.data.candles.find((x) => x.date === data) : null;
      return c ? { minima: c.low, maxima: c.high } : null;
    },
  };
}

export type EntradaDoUsuario = Entrada;

const preparar = (e: EntradaDoUsuario, maxSaida: number): Promise<ArquivoPreparado> =>
  prepararArquivo(e, maxSaida);

export async function estimarImportacaoIA(
  uid: string,
  entradas: EntradaDoUsuario[],
  outroModelo?: string,
): Promise<EstimativaDoArquivo[]> {
  const a = await acessoParaImportar(uid, outroModelo);
  const armazem = armazemDoUsuario(uid, a.provedor, a.modelo);
  return Promise.all(
    entradas.map(async (e) => {
      const p = await preparar(e, a.capacidades.max_saida);
      const emCache =
        !p.atalho &&
        (await armazem.buscar({
          hash: p.hash,
          versao_prompt: VERSAO_DO_PROMPT_DE_IMPORTACAO,
          provedor: a.provedor,
          modelo: a.modelo,
        })) !== null;
      return {
        nome: p.nome,
        hash: p.hash,
        atalho: p.atalho,
        estimativa: p.atalho
          ? null
          : estimarImportacao(p, a.preco, a.capacidades.max_saida),
        precisa_visao: p.arquivo_para_visao !== null,
        sem_texto: p.sem_texto,
        remocoes: p.remocoes,
        em_cache: emCache,
      };
    }),
  );
}

export interface OpcoesDoProcesso {
  outroModelo?: string;
  reprocessar: boolean;
  aceitarImagem: boolean;
  aoAvancar: (arquivo: string, etapa: Etapa, detalhe?: string) => void;
  abortar?: AbortSignal;
}

/** Processa um arquivo. Atalho volta como tal: o navegador usa o importador de sempre. */
export async function processarImportacaoIA(
  uid: string,
  e: EntradaDoUsuario,
  o: OpcoesDoProcesso,
): Promise<{ atalho: ArquivoPreparado["atalho"]; resultado: ResultadoNaTela | null }> {
  const a = await acessoParaImportar(uid, o.outroModelo);
  const nome = "texto" in e ? "texto colado" : e.nome;
  o.aoAvancar(nome, "extraindo");
  const arquivo = await preparar(e, a.capacidades.max_saida);
  if (arquivo.atalho) return { atalho: arquivo.atalho, resultado: null };
  const r = await importarComIA({
    arquivo,
    original:
      a.guardar_original && !("texto" in e) ? { mime: e.mime, dados: e.bytes } : null,
    modelo: criarModelo(a, a.modelo),
    provedor: a.provedor,
    nome_do_modelo: a.modelo,
    preco: a.preco,
    capacidades: a.capacidades,
    armazem: armazemDoUsuario(uid, a.provedor, a.modelo),
    verificador: verificadorDoMarketData(),
    hoje: hojeEmSp(),
    tolerancia: env.ASSISTANT_IMPORT_TOLERANCE,
    limite_diario: env.ASSISTANT_IMPORT_DAILY,
    reprocessar: o.reprocessar,
    aceitou_enviar_imagem: o.aceitarImagem,
    segredos: a.chave ? [a.chave] : [],
    aoErrar: (detalhe) => registrarErro(`importacao: ${detalhe}`),
    aoAvancar: (etapa, detalhe) => o.aoAvancar(nome, etapa, detalhe),
    ...(o.abortar ? { abortar: o.abortar } : {}),
  });
  return { atalho: null, resultado: r };
}

async function lerExtracao(uid: string, id: string) {
  const l = await comoUsuario(banco(), uid, async (tx) => {
    const [l] = await tx
      .select({
        id: extractions.id,
        nome: extractions.nome_arquivo,
        relatorio: extractions.relatorio,
      })
      .from(extractions)
      .where(and(eq(extractions.id, id), eq(extractions.user_id, uid)));
    return l ?? null;
  });
  if (!l) throw new ErroDeImportacao("nao_encontrada", "Extração não encontrada.", 404);
  return { ...l, relatorio: l.relatorio as ResultadoDaValidacao | null };
}

const csvDasPosicoes = (linhas: LinhaEditada[]) =>
  csvDePosicoes(
    COLUNAS_POSICAO,
    linhas.filter((l) => l.tipo === "posicao").map((l) => l.dados),
  );

const csvDasTransacoes = (linhas: LinhaEditada[]) =>
  csvDeTransacoes(
    COLUNAS_BOLSIQ,
    linhas.filter((l) => l.tipo !== "posicao").map((l) => l.dados),
  );

/** A revisao de sempre (`revisarCarga`) sobre as linhas marcadas e editadas. */
export async function revisarImportacaoIA(
  uid: string,
  carteira: string,
  extracaoId: string,
  linhas: LinhaEditada[],
): Promise<RevisaoDeCarga | null> {
  await lerExtracao(uid, extracaoId);
  if (!linhas.some((l) => l.tipo === "posicao")) return null;
  return revisarPosicao(uid, carteira, csvDasPosicoes(linhas));
}

/**
 * Grava o que o usuario confirmou, pelos caminhos de sempre: posicoes pela carga
 * de posicao, transacoes e proventos pelo CSV do Bolsiq. Linha editada passa de
 * novo pelas conferencias que nao dependem do documento (data, ticker, faixa).
 */
export async function confirmarImportacaoIA(
  uid: string,
  carteira: string,
  p: PedidoDeConfirmacaoIA,
): Promise<RelatorioNaTela> {
  const extracao = await lerExtracao(uid, p.extracao_id);
  if (extracao.relatorio && !extracao.relatorio.conciliada && !p.aceitar_nao_conciliada)
    throw new ErroDeImportacao(
      "nao_conciliada",
      "A carga não está conciliada com o documento. Confirme que conferiu os totais.",
      409,
    );
  const conferidas = await validarLinhasEditadas(p.linhas, verificadorDoMarketData(), {
    hoje: hojeEmSp(),
  });
  if (conferidas.rejeicoes.length > 0)
    throw new ErroDeImportacao(
      "linhas_invalidas",
      `Corrija antes de confirmar: ${conferidas.rejeicoes
        .slice(0, 3)
        .map((r) => r.motivo)
        .join("; ")}.`,
    );
  const nome = `IA: ${extracao.nome}`.slice(0, 200);
  const temPosicao = p.linhas.some((l) => l.tipo === "posicao");
  const temTransacao = p.linhas.some((l) => l.tipo !== "posicao");
  const inicio = performance.now();
  const relatorios: RelatorioNaTela[] = [];
  if (temPosicao)
    relatorios.push(
      await importarPosicao(uid, carteira, nome, csvDasPosicoes(p.linhas), p.decisoes),
    );
  if (temTransacao)
    relatorios.push(
      await importar(uid, carteira, "bolsiq", nome, csvDasTransacoes(p.linhas)),
    );
  await comoUsuario(banco(), uid, (tx) =>
    tx
      .update(extractions)
      .set({ confirmado_em: sql`now()` })
      .where(eq(extractions.id, p.extracao_id)),
  );
  return {
    linhas_lidas: relatorios.reduce((s, r) => s + r.linhas_lidas, 0),
    linhas_aceitas: relatorios.reduce((s, r) => s + r.linhas_aceitas, 0),
    linhas_rejeitadas: relatorios.reduce((s, r) => s + r.linhas_rejeitadas, 0),
    rejeicoes: relatorios.flatMap((r) => r.rejeicoes),
    duracao_ms: Math.round(performance.now() - inicio),
  };
}
