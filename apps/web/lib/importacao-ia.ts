import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import PgBoss from "pg-boss";
import {
  acessoParaImportar as acessoNoBanco,
  apagarArquivosDoJob,
  capacidadesDoModelo,
  csvDePosicoes,
  csvDeTransacoes,
  decodificar,
  detectarAtalho,
  ErroDeImportacao,
  exigeSenha,
  ferramentasDoSistema,
  importacoesHoje,
  lerChaveMestra,
  modelosParaImportar,
  schema,
  SenhaIncorreta,
  tipoDoArquivo,
  validarLinhasEditadas,
  verificadorPorHttp,
  type Atalho,
  type OpcoesDaCredencial,
  type Provedor,
  type ResultadoDaValidacao,
  type Verificador,
} from "@bolsiq/assistant";
import {
  COLUNAS_BOLSIQ,
  COLUNAS_POSICAO,
  comoUsuario,
  type RevisaoDeCarga,
} from "@bolsiq/portfolio";
import { banco } from "./analytics";
import { ErroDoAssistente } from "./assistente";
import {
  importar,
  importarPosicao,
  revisarPosicao,
  type RelatorioNaTela,
} from "./carteira";
import { env } from "./env";
import type {
  ArquivoDoJobNaTela,
  EstadoDaImportacaoIA,
  JobNaTela,
  LinhaEditada,
  PedidoDeConfirmacaoIA,
  ResultadoNaTela,
} from "./importacao-ia-modelo";
import { hojeEmSp } from "./indicadores-tecnicos";
import { buscarV1, VALIDADE } from "./market-data";

const { settings, extractions, importJobs, importJobFiles } = schema;

/**
 * Importacao com IA (ADR 0026 e 0027). O web recebe os arquivos, cria o job e
 * acompanha; quem processa e o portfolio-worker. A IA so propoe linhas: a
 * gravacao e a da carga de posicao e do CSV de transacoes, so na confirmacao.
 */

export const FILA_DA_IMPORTACAO = "assistant.importacao";

const lerSettings = (uid: string) =>
  comoUsuario(banco(), uid, async (tx) => {
    const [s] = await tx.select().from(settings).where(eq(settings.user_id, uid));
    return s ?? null;
  });

export async function estadoDaImportacaoIA(uid: string): Promise<EstadoDaImportacaoIA> {
  const [s, feitas] = await Promise.all([
    lerSettings(uid),
    importacoesHoje(banco(), uid, hojeEmSp()),
  ]);
  const provedor = (s?.provedor ?? null) as Provedor | null;
  const modelo = s?.modelo ?? null;
  const c = provedor && modelo ? capacidadesDoModelo(provedor, modelo) : null;
  return {
    configurado: Boolean(provedor && modelo),
    provedor,
    modelo,
    // Basta texto (ADR 0027): as capacidades escolhem a estrategia, nao bloqueiam.
    pode_importar: c !== null,
    visao: c?.visao ?? false,
    consentiu: Boolean(s?.consentimento_importacao_em),
    guardar_original: s?.guardar_original ?? false,
    limite_diario: env.ASSISTANT_IMPORT_DAILY,
    feitas_hoje: feitas,
    modelos: provedor ? modelosParaImportar(provedor) : [],
    limites: {
      mb: env.ASSISTANT_IMPORT_MAX_MB,
      paginas: env.ASSISTANT_IMPORT_MAX_PAGES,
      arquivos: env.ASSISTANT_IMPORT_MAX_FILES,
      confirmar_acima_usd: env.ASSISTANT_IMPORT_CONFIRM_USD,
    },
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

function opcoesDaCredencial(): OpcoesDaCredencial {
  let mestra: Buffer | null = null;
  try {
    mestra = lerChaveMestra(env.ASSISTANT_MASTER_KEY);
  } catch {
    mestra = null;
  }
  return {
    mestra,
    ollama_url: env.ASSISTANT_OLLAMA_URL,
    ollama_hosts: env.ASSISTANT_OLLAMA_HOSTS.split(",")
      .map((h) => h.trim())
      .filter(Boolean),
    deepseek_url: env.ASSISTANT_DEEPSEEK_URL ?? null,
  };
}

/** O que o market-data sabe, pelo /v1 com o cache do Next. */
export function verificadorDoMarketData(): Verificador {
  return verificadorPorHttp((caminho) =>
    buscarV1<unknown>(
      caminho,
      caminho.startsWith("history") ? VALIDADE.history : VALIDADE.assets,
    ),
  );
}

// ---------------------------------------------------------------------------
// Fila
// ---------------------------------------------------------------------------

let fila: Promise<PgBoss> | null = null;

/** Cliente do pg-boss so para enfileirar: quem trabalha e o portfolio-worker. */
function filaDoWeb(): Promise<PgBoss> {
  fila ??= (async () => {
    const boss = new PgBoss({
      connectionString: env.DATABASE_URL,
      schema: "pgboss",
      supervise: false,
      schedule: false,
    });
    boss.on("error", (e) =>
      process.stderr.write(
        `${JSON.stringify({ level: "error", modulo: "importacao", msg: String(e) })}\n`,
      ),
    );
    await boss.start();
    await boss.createQueue(FILA_DA_IMPORTACAO, {
      name: FILA_DA_IMPORTACAO,
      retryLimit: 0,
      expireInSeconds: 60 * 60 * 3,
    });
    return boss;
  })();
  return fila;
}

async function enfileirar(dados: {
  job_id: string;
  user_id: string;
  modelo?: string;
  reprocessar?: { indice: number; lotes?: number[] };
}): Promise<void> {
  await (await filaDoWeb()).send(FILA_DA_IMPORTACAO, dados);
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

export interface ArquivoEnviado {
  nome: string;
  mime: string;
  bytes: Uint8Array;
  corretora: string;
  senha: string;
}

export interface ResultadoDoEnvio {
  job_id: string | null;
  /** Arquivos ja no layout do Bolsiq: a tela os manda pelo importador sem IA. */
  atalhos: { nome: string; atalho: Atalho }[];
}

/**
 * Cria o job. Antes, sem IA: limites, atalho (CSV ja no layout vai pelo
 * importador de sempre), e o PDF com senha, aberto aqui com qpdf; a senha nao e
 * gravada nem vai ao worker, so o PDF decifrado, que sai do banco no fim.
 */
export async function criarJobDeImportacao(
  uid: string,
  carteira: string,
  arquivos: ArquivoEnviado[],
  o: { modelo?: string; aceitar_imagem: boolean },
): Promise<ResultadoDoEnvio> {
  if (arquivos.length > env.ASSISTANT_IMPORT_MAX_FILES)
    throw new ErroDeImportacao(
      "arquivos_demais",
      `Envie até ${env.ASSISTANT_IMPORT_MAX_FILES} arquivos por vez.`,
    );
  // Confere configuracao e consentimento antes de guardar qualquer arquivo.
  await acessoNoBanco(banco(), uid, opcoesDaCredencial(), o.modelo);

  const limite = env.ASSISTANT_IMPORT_MAX_MB * 1024 * 1024;
  const atalhos: ResultadoDoEnvio["atalhos"] = [];
  const precisaSenha: string[] = [];
  const paraOJob: ArquivoEnviado[] = [];
  const ferramentas = await ferramentasDoSistema();
  for (const a of arquivos) {
    if (a.bytes.byteLength === 0)
      throw new ErroDeImportacao("vazio", `${a.nome} está vazio.`);
    if (a.bytes.byteLength > limite)
      throw new ErroDeImportacao(
        "grande_demais",
        `${a.nome} passa de ${env.ASSISTANT_IMPORT_MAX_MB} MB. Divida o arquivo por período ou por conta.`,
        413,
      );
    const tipo = tipoDoArquivo(a.nome, a.mime, a.bytes);
    if (tipo === "csv" || tipo === "txt") {
      const atalho = detectarAtalho(decodificar(a.bytes));
      if (atalho) {
        atalhos.push({ nome: a.nome, atalho });
        continue;
      }
    }
    if (tipo === "pdf" && (await exigeSenha(a.bytes))) {
      if (!a.senha) {
        precisaSenha.push(a.nome);
        continue;
      }
      if (!ferramentas.decifrarPdf)
        throw new ErroDeImportacao(
          "sem_qpdf",
          "Este servidor não consegue abrir PDF com senha. Salve o PDF sem senha e envie de novo.",
          503,
        );
      try {
        paraOJob.push({
          ...a,
          bytes: await ferramentas.decifrarPdf(a.bytes, a.senha),
          senha: "",
        });
      } catch (e) {
        if (e instanceof SenhaIncorreta)
          throw new ErroDeImportacao(
            "senha_incorreta",
            `A senha de ${a.nome} não confere.`,
            422,
          );
        throw e;
      }
      continue;
    }
    paraOJob.push(a);
  }
  if (precisaSenha.length > 0)
    throw new ErroDeImportacao(
      "precisa_senha",
      `${precisaSenha.join(", ")} ${precisaSenha.length === 1 ? "tem" : "têm"} senha. Informe para abrir (muitos bancos usam parte do CPF).`,
      422,
    );
  if (paraOJob.length === 0) return { job_id: null, atalhos };

  const id = randomUUID();
  await comoUsuario(banco(), uid, async (tx) => {
    await tx.insert(importJobs).values({
      id,
      user_id: uid,
      carteira_id: carteira,
      status: "lendo",
      modelo: o.modelo ?? null,
      aceitou_imagem: o.aceitar_imagem,
    });
    await tx.insert(importJobFiles).values(
      paraOJob.map((a, indice) => ({
        id: randomUUID(),
        job_id: id,
        user_id: uid,
        indice,
        nome: a.nome.slice(0, 200),
        mime: a.mime,
        tamanho: a.bytes.byteLength,
        corretora: a.corretora.trim().slice(0, 60) || null,
        dados: Buffer.from(a.bytes),
        estado: "pendente",
      })),
    );
  });
  await enfileirar({
    job_id: id,
    user_id: uid,
    ...(o.modelo ? { modelo: o.modelo } : {}),
  });
  return { job_id: id, atalhos };
}

// ---------------------------------------------------------------------------
// Acompanhamento
// ---------------------------------------------------------------------------

/** O job como a tela ve, sem os bytes e sem o resultado (que vem por arquivo). */
export async function lerJob(uid: string, jobId: string): Promise<JobNaTela> {
  const r = await comoUsuario(banco(), uid, async (tx) => {
    const [j] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId));
    if (!j) return null;
    const arquivos = await tx
      .select({
        indice: importJobFiles.indice,
        nome: importJobFiles.nome,
        corretora: importJobFiles.corretora,
        estado: importJobFiles.estado,
        progresso: importJobFiles.progresso,
        estrategia: importJobFiles.estrategia,
        estimativa: importJobFiles.estimativa,
        erro: importJobFiles.erro,
        tem_resultado: sql<boolean>`${importJobFiles.resultado} is not null`,
        tem_arquivo: sql<boolean>`${importJobFiles.dados} is not null`,
      })
      .from(importJobFiles)
      .where(eq(importJobFiles.job_id, jobId))
      .orderBy(importJobFiles.indice);
    return { j, arquivos };
  });
  if (!r)
    throw new ErroDeImportacao("job_nao_encontrado", "Importação não encontrada.", 404);
  return {
    id: r.j.id,
    carteira_id: r.j.carteira_id,
    status: r.j.status as JobNaTela["status"],
    estimativa: (r.j.estimativa as JobNaTela["estimativa"]) ?? null,
    erro: r.j.erro,
    criado_em: r.j.criado_em,
    arquivos: r.arquivos as ArquivoDoJobNaTela[],
  };
}

export async function lerResultadoDoArquivo(
  uid: string,
  jobId: string,
  indice: number,
): Promise<ResultadoNaTela> {
  const r = await comoUsuario(banco(), uid, async (tx) => {
    const [l] = await tx
      .select({ resultado: importJobFiles.resultado })
      .from(importJobFiles)
      .where(and(eq(importJobFiles.job_id, jobId), eq(importJobFiles.indice, indice)));
    return l?.resultado ?? null;
  });
  if (!r)
    throw new ErroDeImportacao(
      "sem_resultado",
      "Este arquivo ainda não tem resultado.",
      404,
    );
  return r as ResultadoNaTela;
}

export async function confirmarCustoDoJob(uid: string, jobId: string): Promise<void> {
  const job = await lerJob(uid, jobId);
  if (job.status !== "aguardando_confirmacao")
    throw new ErroDeImportacao(
      "estado_invalido",
      "Esta importação não está esperando confirmação.",
      409,
    );
  await comoUsuario(banco(), uid, (tx) =>
    tx
      .update(importJobs)
      .set({ confirmado: true, status: "lendo", atualizado_em: sql`now()` })
      .where(eq(importJobs.id, jobId)),
  );
  await enfileirar({ job_id: jobId, user_id: uid });
}

/** Cancela e apaga os arquivos. Se o worker estiver no meio, ele para no proximo lote. */
export async function cancelarJob(uid: string, jobId: string): Promise<void> {
  const job = await lerJob(uid, jobId);
  await comoUsuario(banco(), uid, (tx) =>
    tx
      .update(importJobs)
      .set({
        cancelado: true,
        ...(job.status === "extraindo" ? {} : { status: "cancelado" }),
        atualizado_em: sql`now()`,
      })
      .where(eq(importJobs.id, jobId)),
  );
  if (job.status !== "extraindo") await apagarArquivosDoJob(banco(), uid, jobId);
}

/** Outra tentativa de um arquivo: os lotes que falharam, ou tudo com outro modelo. */
export async function reprocessarArquivo(
  uid: string,
  jobId: string,
  indice: number,
  o: { lotes?: number[]; modelo?: string },
): Promise<void> {
  const job = await lerJob(uid, jobId);
  const arquivo = job.arquivos.find((a) => a.indice === indice);
  if (!arquivo)
    throw new ErroDeImportacao("arquivo_nao_encontrado", "Arquivo não encontrado.", 404);
  if (!arquivo.tem_arquivo)
    throw new ErroDeImportacao(
      "arquivo_apagado",
      "O arquivo já saiu do servidor (confirmado, cancelado ou com mais de 24 horas). Envie de novo.",
      410,
    );
  await acessoNoBanco(banco(), uid, opcoesDaCredencial(), o.modelo);
  await comoUsuario(banco(), uid, async (tx) => {
    await tx
      .update(importJobs)
      .set({
        status: "extraindo",
        cancelado: false,
        confirmado: true,
        atualizado_em: sql`now()`,
      })
      .where(eq(importJobs.id, jobId));
    await tx
      .update(importJobFiles)
      .set({ estado: "pendente", erro: null, atualizado_em: sql`now()` })
      .where(and(eq(importJobFiles.job_id, jobId), eq(importJobFiles.indice, indice)));
  });
  await enfileirar({
    job_id: jobId,
    user_id: uid,
    ...(o.modelo ? { modelo: o.modelo } : {}),
    reprocessar: { indice, ...(o.lotes?.length ? { lotes: o.lotes } : {}) },
  });
}

/** O ultimo job da carteira que ainda importa (para voltar a pagina depois). */
export async function ultimoJob(
  uid: string,
  carteira: string,
): Promise<JobNaTela | null> {
  const id = await comoUsuario(banco(), uid, async (tx) => {
    const [j] = await tx
      .select({ id: importJobs.id })
      .from(importJobs)
      .where(
        and(
          eq(importJobs.carteira_id, carteira),
          sql`${importJobs.criado_em} > now() - interval '24 hours'`,
        ),
      )
      .orderBy(sql`${importJobs.criado_em} desc`)
      .limit(1);
    return j?.id ?? null;
  });
  return id ? lerJob(uid, id) : null;
}

// ---------------------------------------------------------------------------
// Revisao e confirmacao
// ---------------------------------------------------------------------------

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
 * Depois, o arquivo do job sai do banco.
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
      "Os totais não batem com o documento. Confira e confirme que quer importar assim.",
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
  if (p.job_id) await apagarArquivosDoJob(banco(), uid, p.job_id);
  return {
    linhas_lidas: relatorios.reduce((s, r) => s + r.linhas_lidas, 0),
    linhas_aceitas: relatorios.reduce((s, r) => s + r.linhas_aceitas, 0),
    linhas_rejeitadas: relatorios.reduce((s, r) => s + r.linhas_rejeitadas, 0),
    rejeicoes: relatorios.flatMap((r) => r.rejeicoes),
    duracao_ms: Math.round(performance.now() - inicio),
  };
}

export { ErroDoAssistente };
