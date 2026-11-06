import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, sql, sum } from "drizzle-orm";
import { executarScreener, indicators, IndicadorFiltravel } from "@bolsiq/analytics";
import {
  cifrarChave,
  classificarModelo,
  custoEstimado,
  decifrarChave,
  finalDaChave,
  lerChaveMestra,
  listarModelos,
  MAX_MENSAGENS_NO_HISTORICO,
  mensagemSegura,
  PerfilDoInvestidor,
  PROVEDORES,
  registroDoModelo,
  schema,
  testarConexao,
  urlDoOllama,
  ErroDoProvedor,
  type CarteiraResumida,
  type Credencial,
  type Fontes,
  type IndicadoresDoAtivo,
  type ModeloClassificado,
  type Proveniencia,
  type Provedor,
} from "@bolsiq/assistant";
import type { ResponseMeta } from "@bolsiq/contracts";
import { comoUsuario } from "@bolsiq/portfolio";
import { banco } from "./analytics";
import type {
  EstadoDoAssistente,
  ResultadoDoTeste,
  SalvarConfiguracao,
  TestarConexao,
} from "./assistente-modelo";
import { ErroDeCarteira, listarCarteiras, painel } from "./carteira";
import { retornoDaSerie } from "./carteira-modelo";
import { montarComparacao } from "./comparar";
import { env } from "./env";
import { hojeEmSp } from "./indicadores-tecnicos";
import { buscarV1, VALIDADE } from "./market-data";

const { settings, investorProfiles, conversations, messages, usage } = schema;

export class ErroDoAssistente extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/** Log JSON sem nada do pedido: so texto ja limpo por `mensagemSegura`. */
export function registrarErro(mensagem: string): void {
  process.stderr.write(
    `${JSON.stringify({ level: "error", modulo: "assistente", mensagem })}\n`,
  );
}

const inicioDoDia = () => `${hojeEmSp()}T00:00:00-03:00`;
const inicioDoMes = () => `${hojeEmSp().slice(0, 7)}-01T00:00:00-03:00`;

function hostsDoOllama(): string[] {
  return env.ASSISTANT_OLLAMA_HOSTS.split(",")
    .map((h) => h.trim())
    .filter(Boolean);
}

function baseDoProvedor(
  provedor: Provedor,
  url: string | null | undefined,
): string | null {
  if (provedor === "ollama")
    return urlDoOllama(url || env.ASSISTANT_OLLAMA_URL, hostsDoOllama());
  if (provedor === "deepseek") return env.ASSISTANT_DEEPSEEK_URL ?? null;
  return null;
}

function mestra(): Buffer {
  try {
    return lerChaveMestra(env.ASSISTANT_MASTER_KEY);
  } catch {
    throw new ErroDoAssistente(
      503,
      "sem_chave_mestra",
      "O assistente não tem ASSISTANT_MASTER_KEY configurada neste ambiente.",
    );
  }
}

/** Limite diario na chave da plataforma. Sem tabela de planos ainda, todos sao "gratis". */
export function limiteDaPlataforma(plano = "gratis"): number {
  for (const parte of env.ASSISTANT_PLATFORM_LIMITS.split(",")) {
    const [nome, valor] = parte.split(":");
    if (nome?.trim() === plano && Number(valor) > 0) return Number(valor);
  }
  return 0;
}

const lerSettings = (uid: string) =>
  comoUsuario(banco(), uid, async (tx) => {
    const [l] = await tx.select().from(settings).where(eq(settings.user_id, uid));
    return l ?? null;
  });

export async function estadoDoAssistente(uid: string): Promise<EstadoDoAssistente> {
  const hoje = inicioDoDia();
  const mes = inicioDoMes();
  const { s, perfil, usadas, consumo } = await comoUsuario(banco(), uid, async (tx) => {
    const [s] = await tx.select().from(settings).where(eq(settings.user_id, uid));
    const [perfil] = await tx
      .select({ id: investorProfiles.user_id })
      .from(investorProfiles)
      .where(eq(investorProfiles.user_id, uid));
    const [usadas] = await tx
      .select({ n: count() })
      .from(usage)
      .where(and(eq(usage.user_id, uid), gte(usage.criado_em, hoje)));
    const [consumo] = await tx
      .select({
        entrada: sum(usage.tokens_entrada),
        saida: sum(usage.tokens_saida),
        custo: sum(usage.custo_estimado),
      })
      .from(usage)
      .where(and(eq(usage.user_id, uid), gte(usage.criado_em, mes)));
    return { s, perfil, usadas, consumo };
  });
  const provedor = (s?.provedor ?? null) as Provedor | null;
  const modelo = s?.modelo ?? null;
  const classificado =
    provedor && modelo
      ? classificarModelo(provedor, {
          id: modelo,
          nome: modelo,
          preco_entrada: null,
          preco_saida: null,
          ferramentas: null,
        })
      : null;
  const plataforma = Boolean(env.ASSISTANT_PLATFORM_KEY);
  return {
    provedor,
    modelo,
    chave_final: s?.chave_final ?? null,
    base_url: s?.base_url ?? null,
    url_ollama_padrao: env.ASSISTANT_OLLAMA_URL,
    status_modelo: classificado?.status ?? null,
    aviso_modelo: classificado?.aviso ?? null,
    consentiu: Boolean(s?.consentimento_em),
    configurado: Boolean(provedor && modelo),
    plataforma,
    modo: env.ASSISTANT_RECOMMENDATIONS,
    perfil_preenchido: Boolean(perfil),
    limite_diario: env.ASSISTANT_DAILY_MESSAGES,
    usadas_hoje: usadas?.n ?? 0,
    consumo_mes: {
      tokens_entrada: Number(consumo?.entrada ?? 0),
      tokens_saida: Number(consumo?.saida ?? 0),
      custo_estimado: consumo?.custo ?? null,
    },
  };
}

/** Credencial do formulario ou a salva. Descriptografa so aqui, no BFF. */
async function credencialDoTeste(uid: string, t: TestarConexao): Promise<Credencial> {
  let chave = t.chave || null;
  if (!chave && PROVEDORES[t.provedor].exigeChave) {
    const s = await lerSettings(uid);
    if (s?.provedor === t.provedor && s.chave_cifrada)
      chave = decifrarChave(s.chave_cifrada, mestra(), uid);
  }
  return { provedor: t.provedor, chave, baseUrl: baseDoProvedor(t.provedor, t.base_url) };
}

export async function testar(uid: string, t: TestarConexao): Promise<ResultadoDoTeste> {
  let credencial: Credencial;
  try {
    credencial = await credencialDoTeste(uid, t);
  } catch (e) {
    if (e instanceof ErroDoProvedor)
      return { ok: false, mensagem: e.message, modelos: [] };
    throw e;
  }
  const r = await testarConexao(credencial);
  if (!r.ok) return { ok: false, mensagem: r.mensagem, modelos: [] };
  return {
    ok: true,
    mensagem: "Conexão ok.",
    modelos: ordenar(r.modelos.map((m) => classificarModelo(t.provedor, m))),
  };
}

const ORDEM = { homologado: 0, experimental: 1, bloqueado: 2 };
function ordenar(m: ModeloClassificado[]): ModeloClassificado[] {
  return [...m].sort(
    (a, b) => ORDEM[a.status] - ORDEM[b.status] || a.nome.localeCompare(b.nome),
  );
}

/** Salva e confere no provedor: modelo sem ferramentas nao entra nem por API. */
export async function salvarConfiguracao(
  uid: string,
  c: SalvarConfiguracao,
): Promise<void> {
  const atual = await lerSettings(uid);
  const exige = PROVEDORES[c.provedor].exigeChave;
  const mantem = !c.chave && atual?.provedor === c.provedor && atual.chave_cifrada;
  if (exige && !c.chave && !mantem)
    throw new ErroDoAssistente(422, "validation_error", "Informe a chave do provedor.");

  let base: string | null;
  try {
    base = baseDoProvedor(c.provedor, c.base_url);
  } catch (e) {
    if (e instanceof ErroDoProvedor)
      throw new ErroDoAssistente(422, "validation_error", e.message);
    throw e;
  }
  const chave =
    c.chave ??
    (mantem ? decifrarChave(atual.chave_cifrada as string, mestra(), uid) : null);

  let modelos: ModeloClassificado[];
  try {
    modelos = (await listarModelos({ provedor: c.provedor, chave, baseUrl: base })).map(
      (m) => classificarModelo(c.provedor, m),
    );
  } catch (e) {
    throw new ErroDoAssistente(
      422,
      "validation_error",
      e instanceof ErroDoProvedor
        ? e.message
        : `Não foi possível falar com o provedor: ${mensagemSegura(e, [chave ?? ""])}`,
    );
  }
  const modelo = modelos.find((m) => m.id === c.modelo);
  if (!modelo)
    throw new ErroDoAssistente(
      422,
      "validation_error",
      "O provedor não lista esse modelo.",
    );
  if (modelo.status === "bloqueado")
    throw new ErroDoAssistente(
      422,
      "validation_error",
      modelo.aviso ?? "Modelo bloqueado.",
    );

  const valores = {
    provedor: c.provedor,
    modelo: c.modelo,
    chave_cifrada: chave ? cifrarChave(chave, mestra(), uid) : null,
    chave_final: chave ? finalDaChave(chave) : null,
    base_url: c.provedor === "ollama" ? base : null,
    preco_entrada: modelo.preco_entrada?.toString() ?? null,
    preco_saida: modelo.preco_saida?.toString() ?? null,
    atualizado_em: sql`now()`,
  };
  await comoUsuario(banco(), uid, (tx) =>
    tx
      .insert(settings)
      .values({ user_id: uid, ...valores })
      .onConflictDoUpdate({ target: settings.user_id, set: valores }),
  );
}

/** Apaga a chave e o provedor; mantem o consentimento. */
export async function removerConfiguracao(uid: string): Promise<void> {
  await comoUsuario(banco(), uid, (tx) =>
    tx
      .update(settings)
      .set({
        provedor: null,
        modelo: null,
        chave_cifrada: null,
        chave_final: null,
        base_url: null,
        preco_entrada: null,
        preco_saida: null,
        atualizado_em: sql`now()`,
      })
      .where(eq(settings.user_id, uid)),
  );
}

export async function registrarConsentimento(uid: string): Promise<void> {
  await comoUsuario(banco(), uid, (tx) =>
    tx
      .insert(settings)
      .values({ user_id: uid, consentimento_em: sql`now()` })
      .onConflictDoUpdate({
        target: settings.user_id,
        set: { consentimento_em: sql`now()`, atualizado_em: sql`now()` },
      }),
  );
}

export interface AcessoAoModelo extends Credencial {
  modelo: string;
  plataforma: boolean;
  preco: { entrada: number | null; saida: number | null };
}

/**
 * Tudo o que a chamada precisa, validando consentimento e limites. Chave em
 * memoria so durante a requisicao; nao vai para log, resposta nem banco em claro.
 */
export async function acessoParaConversar(uid: string): Promise<AcessoAoModelo> {
  const hoje = inicioDoDia();
  const { s, usadas, naPlataforma } = await comoUsuario(banco(), uid, async (tx) => {
    const [s] = await tx.select().from(settings).where(eq(settings.user_id, uid));
    const [usadas] = await tx
      .select({ n: count() })
      .from(usage)
      .where(and(eq(usage.user_id, uid), gte(usage.criado_em, hoje)));
    const [naPlataforma] = await tx
      .select({ n: count() })
      .from(usage)
      .where(
        and(
          eq(usage.user_id, uid),
          gte(usage.criado_em, hoje),
          eq(usage.plataforma, true),
        ),
      );
    return { s, usadas, naPlataforma };
  });

  if (!s?.consentimento_em)
    throw new ErroDoAssistente(
      409,
      "consentimento",
      "Confirme o envio de dados ao provedor antes da primeira conversa.",
    );
  if ((usadas?.n ?? 0) >= env.ASSISTANT_DAILY_MESSAGES)
    throw new ErroDoAssistente(
      429,
      "limite_diario",
      `Você chegou ao limite de ${env.ASSISTANT_DAILY_MESSAGES} mensagens por dia.`,
    );

  if (s.provedor && s.modelo) {
    const provedor = s.provedor as Provedor;
    const registro = registroDoModelo(provedor, s.modelo);
    if (registro?.status === "sem_ferramentas")
      throw new ErroDoAssistente(
        409,
        "modelo_bloqueado",
        "Este modelo não tem chamada de ferramentas. Escolha outro em Configurações.",
      );
    return {
      provedor,
      modelo: s.modelo,
      chave: s.chave_cifrada ? decifrarChave(s.chave_cifrada, mestra(), uid) : null,
      baseUrl: baseDoProvedor(provedor, s.base_url),
      plataforma: false,
      preco: {
        entrada: s.preco_entrada === null ? null : Number(s.preco_entrada),
        saida: s.preco_saida === null ? null : Number(s.preco_saida),
      },
    };
  }

  if (env.ASSISTANT_PLATFORM_KEY) {
    if ((naPlataforma?.n ?? 0) >= limiteDaPlataforma())
      throw new ErroDoAssistente(
        429,
        "limite_da_plataforma",
        "Você chegou ao limite do dia na chave do Bolsiq. Configure a sua para continuar.",
      );
    const provedor = env.ASSISTANT_PLATFORM_PROVIDER;
    const r = registroDoModelo(provedor, env.ASSISTANT_PLATFORM_MODEL);
    return {
      provedor,
      modelo: env.ASSISTANT_PLATFORM_MODEL,
      chave: env.ASSISTANT_PLATFORM_KEY,
      baseUrl: baseDoProvedor(provedor, null),
      plataforma: true,
      preco: { entrada: r?.preco_entrada ?? null, saida: r?.preco_saida ?? null },
    };
  }

  throw new ErroDoAssistente(
    409,
    "nao_configurado",
    "Escolha um provedor e cole sua chave em Configurações.",
  );
}

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------

export async function lerPerfil(uid: string): Promise<PerfilDoInvestidor | null> {
  const [l] = await comoUsuario(banco(), uid, (tx) =>
    tx.select().from(investorProfiles).where(eq(investorProfiles.user_id, uid)),
  );
  if (!l) return null;
  const r = PerfilDoInvestidor.safeParse(l.perfil);
  return r.success ? r.data : null;
}

export async function salvarPerfil(uid: string, p: PerfilDoInvestidor): Promise<void> {
  await comoUsuario(banco(), uid, (tx) =>
    tx
      .insert(investorProfiles)
      .values({ user_id: uid, perfil: p })
      .onConflictDoUpdate({
        target: investorProfiles.user_id,
        set: { perfil: p, atualizado_em: sql`now()` },
      }),
  );
}

// ---------------------------------------------------------------------------
// Conversas
// ---------------------------------------------------------------------------

export interface ConversaResumida {
  id: string;
  titulo: string;
  atualizada_em: string;
  tokens_entrada: number;
  tokens_saida: number;
  custo_estimado: string | null;
}

export function listarConversas(uid: string): Promise<ConversaResumida[]> {
  return comoUsuario(banco(), uid, (tx) =>
    tx
      .select({
        id: conversations.id,
        titulo: conversations.titulo,
        atualizada_em: conversations.atualizada_em,
        tokens_entrada: conversations.tokens_entrada,
        tokens_saida: conversations.tokens_saida,
        custo_estimado: conversations.custo_estimado,
      })
      .from(conversations)
      .where(eq(conversations.user_id, uid))
      .orderBy(desc(conversations.atualizada_em))
      .limit(50),
  );
}

export async function lerConversa(uid: string, id: string) {
  return comoUsuario(banco(), uid, async (tx) => {
    const [c] = await tx
      .select({ id: conversations.id, titulo: conversations.titulo })
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.user_id, uid)));
    if (!c) throw new ErroDoAssistente(404, "not_found", "Conversa não encontrada.");
    const linhas = await tx
      .select()
      .from(messages)
      .where(eq(messages.conversation_id, id))
      .orderBy(asc(messages.criada_em));
    return {
      ...c,
      mensagens: linhas.map((m) => ({ id: m.id, role: m.papel, parts: m.partes })),
    };
  });
}

export async function apagarConversa(uid: string, id: string): Promise<void> {
  const r = await comoUsuario(banco(), uid, (tx) =>
    tx
      .delete(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.user_id, uid)))
      .returning({ id: conversations.id }),
  );
  if (r.length === 0)
    throw new ErroDoAssistente(404, "not_found", "Conversa não encontrada.");
}

/** Abre (ou confere) a conversa, grava a pergunta e devolve o historico para o modelo. */
export async function iniciarTurno(uid: string, id: string | undefined, texto: string) {
  return comoUsuario(banco(), uid, async (tx) => {
    let conversa = id;
    if (conversa) {
      const [c] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, conversa), eq(conversations.user_id, uid)));
      if (!c) throw new ErroDoAssistente(404, "not_found", "Conversa não encontrada.");
    } else {
      conversa = randomUUID();
      await tx
        .insert(conversations)
        .values({ id: conversa, user_id: uid, titulo: texto.slice(0, 60) });
    }
    const anteriores = await tx
      .select({ papel: messages.papel, partes: messages.partes })
      .from(messages)
      .where(eq(messages.conversation_id, conversa))
      .orderBy(desc(messages.criada_em))
      .limit(MAX_MENSAGENS_NO_HISTORICO);
    await tx.insert(messages).values({
      id: randomUUID(),
      conversation_id: conversa,
      user_id: uid,
      papel: "user",
      partes: [{ type: "text", text: texto }],
    });
    return { conversa, historico: paraOModelo(anteriores.reverse()) };
  });
}

/**
 * Historico so com o texto: resultados antigos de ferramenta ficam de fora, para
 * nao reenviar carteira a cada turno. Numero antigo o modelo busca de novo.
 */
function paraOModelo(linhas: { papel: string; partes: unknown }[]) {
  return linhas.flatMap((l) => {
    const texto = (l.partes as { type: string; text?: string }[])
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("");
    if (!texto) return [];
    return [
      {
        role: l.papel === "user" ? ("user" as const) : ("assistant" as const),
        content: texto,
      },
    ];
  });
}

export async function encerrarTurno(
  uid: string,
  conversa: string,
  acesso: AcessoAoModelo,
  uso: { tokens_entrada: number; tokens_saida: number },
): Promise<void> {
  const custo = custoEstimado(uso, acesso.preco);
  await comoUsuario(banco(), uid, async (tx) => {
    await tx.insert(usage).values({
      id: randomUUID(),
      user_id: uid,
      conversation_id: conversa,
      provedor: acesso.provedor,
      modelo: acesso.modelo,
      plataforma: acesso.plataforma,
      tokens_entrada: uso.tokens_entrada,
      tokens_saida: uso.tokens_saida,
      custo_estimado: custo,
    });
    await tx
      .update(conversations)
      .set({
        tokens_entrada: sql`${conversations.tokens_entrada} + ${uso.tokens_entrada}`,
        tokens_saida: sql`${conversations.tokens_saida} + ${uso.tokens_saida}`,
        custo_estimado: custo
          ? sql`coalesce(${conversations.custo_estimado}, 0) + ${custo}::numeric`
          : conversations.custo_estimado,
        atualizada_em: sql`now()`,
      })
      .where(eq(conversations.id, conversa));
  });
}

export async function gravarResposta(
  uid: string,
  conversa: string,
  id: string,
  partes: unknown,
): Promise<void> {
  await comoUsuario(banco(), uid, (tx) =>
    tx
      .insert(messages)
      .values({ id, conversation_id: conversa, user_id: uid, papel: "assistant", partes })
      .onConflictDoNothing(),
  );
}

// ---------------------------------------------------------------------------
// Fontes das ferramentas
// ---------------------------------------------------------------------------

const deMeta = (m: ResponseMeta): Proveniencia => ({
  fonte: m.source,
  data: m.fetched_at,
  licenca: m.license,
  atrasado: m.stale,
  ...(m.delay_minutes > 0 ? { atraso_minutos: m.delay_minutes } : {}),
});

async function v1<T>(
  caminho: string,
  validade: number,
): Promise<{ data: T; meta: ResponseMeta }> {
  const r = await buscarV1<{ data: T; meta: ResponseMeta }>(caminho, validade);
  if (r.status !== 200) throw new Error(`v1 respondeu ${r.status}`);
  return r.corpo;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

async function indicadoresDe(
  tickers: string[],
): Promise<Map<string, IndicadoresDoAtivo>> {
  const linhas = await Promise.all(
    tickers.map(async (t) => {
      const [l] = await banco()
        .select()
        .from(indicators)
        .where(eq(indicators.ticker, t))
        .orderBy(desc(indicators.reference_date))
        .limit(1);
      return l;
    }),
  );
  const saida = new Map<string, IndicadoresDoAtivo>();
  for (const l of linhas) {
    if (!l) continue;
    const registro = l as unknown as Record<string, unknown>;
    saida.set(l.ticker, {
      reference_date: l.reference_date,
      preco_graham: l.preco_graham,
      preco_bazin: l.preco_bazin,
      ...Object.fromEntries(IndicadorFiltravel.options.map((n) => [n, num(registro[n])])),
    });
  }
  return saida;
}

/** A carteira que a tela mostra, no formato das ferramentas. Dados do `painel`. */
function resumir(p: Awaited<ReturnType<typeof painel>>): CarteiraResumida {
  return {
    id: p.carteira.id,
    nome: p.carteira.nome,
    patrimonio: p.resumo.patrimonio,
    custo: p.resumo.custo,
    nao_realizado: p.resumo.nao_realizado,
    nao_realizado_pct: p.resumo.nao_realizado_pct,
    realizado: p.resumo.realizado,
    proventos_12m: p.resumo.proventos_12m,
    twr_12m: p.resumo.twr_12m,
    cdi_12m: p.resumo.cdi_12m,
    ibov_12m: retornoDaSerie(p.serie.map((s) => s.ibov)),
    sem_cotacao: p.resumo.sem_cotacao,
    posicoes: p.posicoes.map((x) => ({
      ticker: x.ticker,
      classe: x.classe,
      setor: x.setor,
      quantidade: x.quantidade,
      preco_medio: x.preco_medio,
      custo_total: x.custo_total,
      preco_atual: x.preco_atual,
      valor_de_mercado: x.valor_de_mercado,
      resultado_nao_realizado: x.resultado_nao_realizado,
      resultado_realizado: x.resultado_realizado,
      rentabilidade: x.rentabilidade,
      proventos_recebidos: x.proventos_recebidos,
    })),
    alocacao: p.alocacao,
    serie: p.serie.map((s) => ({ data: s.data, carteira: s.carteira, ibov: s.ibov })),
    recalculando: p.recalculando,
  };
}

/** Implementacao real de `Fontes`, presa ao usuario logado: o modelo nao escolhe o dono. */
export function fontesDoUsuario(uid: string): Fontes {
  return {
    async cotacoes(tickers) {
      const r = await v1<
        {
          ticker: string;
          price: string;
          change_percent: string;
          quoted_at: string;
          stale: boolean;
        }[]
      >(`quotes/${tickers.join(",")}`, VALIDADE.quotes);
      return {
        dados: r.data.map((q) => ({
          ticker: q.ticker,
          price: q.price,
          change_percent: q.change_percent,
          quoted_at: q.quoted_at,
          stale: q.stale,
        })),
        proveniencia: [deMeta(r.meta)],
      };
    },
    async historico(ticker, de) {
      const r = await v1<{ candles: { date: string; close: string }[] }>(
        `history/${ticker}?interval=1d&from=${de}&adjusted=true`,
        VALIDADE.history,
      );
      return {
        dados: r.data.candles.map((c) => ({ date: c.date, close: c.close })),
        proveniencia: [deMeta(r.meta)],
      };
    },
    async proventos(ticker, de) {
      const r = await v1<
        {
          ticker: string;
          kind: string;
          ex_date: string;
          payment_date: string | null;
          value_per_share: string | null;
        }[]
      >(`dividends/${ticker}?from=${de}`, VALIDADE.dividends);
      return { dados: r.data, proveniencia: [deMeta(r.meta)] };
    },
    async fundamentos(ticker, periodo) {
      const r = await v1<{
        periods: {
          reference_date: string;
          statement_kind: string;
          revenue: string | null;
          ebit: string | null;
          net_income: string | null;
          equity: string | null;
          gross_debt: string | null;
          cash_and_equivalents: string | null;
        }[];
      }>(`fundamentals/${ticker}?period=${periodo}`, VALIDADE.fundamentals);
      return {
        dados: r.data.periods.map((p) => ({
          reference_date: p.reference_date,
          statement_kind: p.statement_kind,
          revenue: p.revenue,
          ebit: p.ebit,
          net_income: p.net_income,
          equity: p.equity,
          gross_debt: p.gross_debt,
          cash_and_equivalents: p.cash_and_equivalents,
        })),
        proveniencia: [deMeta(r.meta)],
      };
    },
    indicadores: indicadoresDe,
    async comparar(ids, periodo) {
      const c = await montarComparacao(ids, periodo);
      const semSerie = (s: (typeof c.itens)[number]) => ({
        id: s.id,
        nome: s.nome,
        classe: s.classe,
        estatisticas: s.estatisticas,
        fonte: s.fonte,
        erro: s.erro,
      });
      const fontes = [...new Set(c.itens.flatMap((i) => (i.fonte ? [i.fonte] : [])))];
      return {
        dados: {
          periodo: c.periodo,
          de: c.de,
          itens: c.itens.map(semSerie),
          benchmarks: c.benchmarks.map(semSerie),
          tabela: c.tabela.map((l) => ({
            indicador: l.indicador,
            rotulo: l.rotulo,
            valores: l.valores,
          })),
        },
        proveniencia: fontes.map((fonte) => ({
          fonte,
          data: hojeEmSp(),
          atrasado: false,
        })),
      };
    },
    screener: (filtro) => executarScreener(banco(), filtro),
    async macro(serie, de) {
      const r = await v1<{ points: { date: string; value: string }[] }>(
        `macro/${serie}?from=${de}`,
        VALIDADE.macro,
      );
      return { dados: r.data.points, proveniencia: [deMeta(r.meta)] };
    },
    async carteira(id) {
      const alvo = id ?? (await listarCarteiras(uid))[0]?.id;
      if (!alvo) return null;
      try {
        const p = await painel(uid, alvo);
        return {
          dados: resumir(p),
          proveniencia: [
            {
              fonte: "Transações do usuário e cotação do market-data",
              data: hojeEmSp(),
              atrasado: p.recalculando,
            },
          ],
        };
      } catch (e) {
        if (e instanceof ErroDeCarteira) return null;
        throw e;
      }
    },
    perfil: () => lerPerfil(uid),
  };
}

export const modoDeRecomendacao = () => env.ASSISTANT_RECOMMENDATIONS;
