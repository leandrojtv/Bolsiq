import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, inArray, like, lte, or, sql } from "drizzle-orm";
import { Decimal } from "decimal.js";
import {
  assets,
  dividends,
  fetchLog,
  fiiMonthly,
  financialStatements,
  fundDaily,
  funds,
  liveQuotes,
  macroSeries,
  outbox,
  quotesDaily,
  shareCounts,
  type Db,
} from "@bolsiq/db-core";
import {
  BolsiqError,
  MAX_TICKERS_POR_CONSULTA,
  type AssetDetail,
  type AssetSummary,
  type Candle,
  type Dividend,
  type FiiMonthlyReport,
  type FundDetail,
  type FundSummary,
  type FundamentalsPeriod,
  type Interval,
  type LiveQuote,
  type MacroSeriesName,
  type ResponseMeta,
} from "@bolsiq/contracts";
import {
  agregarVelas,
  ajustarPorProventos,
  resumirContas,
  SERIES_SGS,
  shiftDecimal,
  type EventoDeAjuste,
  type Vela,
} from "@bolsiq/domain";
import { linhaDeOutbox } from "@bolsiq/messaging";
import {
  BRAPI_LICENSE,
  BRAPI_SOURCE,
  type BrapiAdapter,
  type ProventoBrapi,
} from "../fontes/brapi.js";
import { COTAHIST_LICENSE, COTAHIST_SOURCE } from "../fontes/b3-cotahist.js";
import { BCB_LICENSE, BCB_SOURCE, type BcbAdapter } from "../fontes/bcb.js";
import { CVM_LICENSE } from "../fontes/cvm.js";
import { Coalescedor, dentroDoPrazo } from "./coalescedor.js";
import { gravarSerieMacro, PRODUTOR, type Log } from "./ingestao.js";

export interface Resposta<T> {
  data: T;
  meta: ResponseMeta;
}

export interface ServicoDeDados {
  buscarAtivos(q: string, tipo?: string): Promise<Resposta<AssetSummary[]>>;
  ativo(ticker: string): Promise<Resposta<AssetDetail>>;
  cotacoes(tickers: string[]): Promise<Resposta<LiveQuote[]>>;
  historico(
    ticker: string,
    q: { interval: Interval; from?: string; to?: string; adjusted: boolean },
  ): Promise<
    Resposta<{ ticker: string; interval: Interval; adjusted: boolean; candles: Candle[] }>
  >;
  proventos(
    ticker: string,
    q: { from?: string; to?: string },
  ): Promise<Resposta<Dividend[]>>;
  fundamentos(
    ticker: string,
    periodo: "annual" | "quarterly",
  ): Promise<
    Resposta<{
      ticker: string;
      cvm_code: string;
      cnpj: string;
      period: "annual" | "quarterly";
      periods: FundamentalsPeriod[];
    }>
  >;
  buscarFundos(q: string): Promise<Resposta<FundSummary[]>>;
  fundo(cnpj: string): Promise<Resposta<FundDetail>>;
  historicoDeFundo(
    cnpj: string,
    q: { from?: string; to?: string },
  ): Promise<
    Resposta<{
      cnpj: string;
      points: { date: string; nav: string; aum: string; holders: number | null }[];
    }>
  >;
  informesFii(
    ticker: string,
    q: { from?: string; to?: string },
  ): Promise<
    Resposta<{
      ticker: string;
      cnpj: string;
      name: string;
      segment: string | null;
      reports: FiiMonthlyReport[];
    }>
  >;
  macro(
    serie: MacroSeriesName,
    q: { from?: string; to?: string },
  ): Promise<
    Resposta<{
      series: MacroSeriesName;
      unit: string;
      frequency: "daily" | "monthly";
      points: { date: string; value: string }[];
    }>
  >;
}

export interface ConfigDoServico {
  quoteTtlMs: number;
  dividendsTtlMs: number;
  macroTtlMs: number;
  brapiDelayMinutes: number;
  /** Com token, o IBOV vem da brapi; sem, do BOVA11 como aproximacao. */
  brapiComToken: boolean;
}

export const CONFIG_PADRAO: ConfigDoServico = {
  quoteTtlMs: 60_000,
  dividendsTtlMs: 12 * 3_600_000,
  macroTtlMs: 6 * 3_600_000,
  brapiDelayMinutes: 15,
  brapiComToken: false,
};

/** COTAHIST sai depois do fechamento: um pregao de atraso. */
const COTAHIST_DELAY_MINUTES = 24 * 60;

/** Provento com data-ex ate esta janela no passado ainda e "anunciado". */
const JANELA_DE_ANUNCIO_DIAS = 7;

const SERIES_MACRO: Record<
  Exclude<MacroSeriesName, "ibov">,
  { code: string; unit: string; frequency: "daily" | "monthly" }
> = {
  cdi: SERIES_SGS.cdiDiario,
  selic: SERIES_SGS.selicDiaria,
  ipca: SERIES_SGS.ipcaMensal,
  igpm: SERIES_SGS.igpmMensal,
};

const PROXY_IBOV = "BOVA11";

/** Marca no fetch_log de que a brapi nao tem proventos deste ticker para nos. */
const SEM_PROVENTOS = "brapi-dividends-indisponivel";

/** Marca no fetch_log a data inicial ja pedida ao SGS, por serie. */
const COBERTURA_SGS = "bcb-sgs-cobertura";

function hoje(agora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    agora,
  );
}

function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function umAnoAntes(data: string): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Ultimo pregao que ja deveria estar carregado: o COTAHIST do dia sai a noite
 * e o job roda 20:30, entao antes das 21h vale o pregao anterior. Nao conhece
 * feriado, e em feriado marca `stale` sem necessidade; o contrario (esconder
 * atraso real) seria pior.
 */
export function ultimoPregaoEsperado(agora: Date): string {
  const horaSp = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }).format(agora),
  );
  let data = horaSp >= 21 ? hoje(agora) : somarDias(hoje(agora), -1);
  for (;;) {
    const dia = new Date(`${data}T00:00:00Z`).getUTCDay();
    if (dia !== 0 && dia !== 6) return data;
    data = somarDias(data, -1);
  }
}

/**
 * `numeric(20,6)` volta do Postgres com zeros a direita ("52.710000"). O
 * valor e o mesmo, mas o contrato devolve a forma canonica, sem escala fixa.
 */
function n(v: string): string {
  return shiftDecimal(v, 0);
}

function nn(v: string | null): string | null {
  return v === null ? null : n(v);
}

function paraIso(ts: string): string {
  return new Date(ts).toISOString();
}

function naoEncontrado(oque: string): never {
  throw new BolsiqError("not_found", oque);
}

function hashDe(valor: unknown): string {
  return createHash("sha256")
    .update(
      JSON.stringify(valor, (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v)),
    )
    .digest("hex");
}

export function criarServicoDeDados(deps: {
  db: Db;
  brapi: BrapiAdapter;
  bcb: BcbAdapter;
  log: Log;
  config?: Partial<ConfigDoServico>;
  agora?: () => Date;
}): ServicoDeDados {
  const { db, brapi, bcb, log } = deps;
  const config = { ...CONFIG_PADRAO, ...deps.config };
  const agora = deps.agora ?? (() => new Date());
  const coalescedor = new Coalescedor();

  /** Ultima leitura bem-sucedida de uma fonte sem tabela propria de cache. */
  async function ultimaLeitura(source: string, ref: string): Promise<string | null> {
    const [r] = await db
      .select({ fetchedAt: fetchLog.fetchedAt })
      .from(fetchLog)
      .where(
        and(
          eq(fetchLog.source, source),
          eq(fetchLog.sourceRef, ref),
          eq(fetchLog.status, "ok"),
        ),
      )
      .orderBy(desc(fetchLog.fetchedAt))
      .limit(1);
    return r?.fetchedAt ?? null;
  }

  async function marcarLeitura(
    source: string,
    ref: string,
    conteudo: unknown,
    linhas: number,
  ) {
    const instante = agora().toISOString();
    await db
      .insert(fetchLog)
      .values({
        id: randomUUID(),
        source,
        sourceRef: ref,
        contentHash: hashDe(conteudo),
        status: "ok",
        rowsWritten: linhas,
        fetchedAt: instante,
      })
      .onConflictDoUpdate({
        target: [fetchLog.source, fetchLog.sourceRef, fetchLog.contentHash],
        set: { fetchedAt: instante, status: "ok" },
      });
  }

  // -------------------------------------------------------------------------
  // Ativos
  // -------------------------------------------------------------------------

  async function buscarAtivos(
    q: string,
    tipo?: string,
  ): Promise<Resposta<AssetSummary[]>> {
    const termo = q
      .trim()
      .toUpperCase()
      .replace(/[%_\\]/g, "");
    const condicoes = [
      sql`${assets.ticker} IS NOT NULL`,
      or(
        like(assets.ticker, `${termo}%`),
        ilike(assets.name, `%${termo}%`),
        ilike(assets.legalName, `%${termo}%`),
      ),
    ];
    if (tipo) condicoes.push(eq(assets.kind, tipo));

    const linhas = await db
      .select({
        ticker: assets.ticker,
        name: assets.name,
        kind: assets.kind,
        sector: assets.sector,
        fetchedAt: assets.fetchedAt,
      })
      .from(assets)
      .where(and(...condicoes))
      .orderBy(
        sql`(${assets.ticker} = ${termo}) DESC`,
        sql`(${assets.ticker} LIKE ${`${termo}%`}) DESC`,
        sql`length(${assets.ticker})`,
        asc(assets.ticker),
      )
      .limit(20);

    const maisRecente = linhas
      .map((l) => l.fetchedAt)
      .sort()
      .pop();
    return {
      data: linhas.map((l) => ({
        ticker: l.ticker as string,
        name: l.name,
        kind: l.kind as AssetSummary["kind"],
        sector: l.sector,
      })),
      meta: {
        source: `${COTAHIST_SOURCE}+cvm-cadastro`,
        fetched_at: paraIso(maisRecente ?? agora().toISOString()),
        license: `${COTAHIST_LICENSE} (ticker e nome); ${CVM_LICENSE} (dados da CVM)`,
        stale: false,
        delay_minutes: 0,
      },
    };
  }

  async function ativo(ticker: string): Promise<Resposta<AssetDetail>> {
    const [a] = await db.select().from(assets).where(eq(assets.ticker, ticker));
    if (!a) naoEncontrado(`ativo ${ticker} nao esta no universo`);
    const provenance = {
      source: a.source,
      fetched_at: paraIso(a.fetchedAt),
      license: a.license,
      source_ref: a.sourceRef,
    };
    return {
      data: {
        ticker,
        isin: a.isin,
        cnpj: a.cnpj,
        cvm_code: a.cvmCode,
        name: a.name,
        legal_name: a.legalName,
        kind: a.kind as AssetDetail["kind"],
        sector: a.sector,
        status: a.status,
        provenance,
      },
      meta: {
        source: a.cvmCode ? `${a.source}+cvm-cadastro` : a.source,
        fetched_at: provenance.fetched_at,
        license: a.cvmCode ? `${a.license}; ${CVM_LICENSE} (dados da CVM)` : a.license,
        stale: false,
        delay_minutes: 0,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Cotacao corrente: read-through da brapi, com o COTAHIST como reserva
  // -------------------------------------------------------------------------

  function deLinhaLive(l: typeof liveQuotes.$inferSelect, stale: boolean): LiveQuote {
    return {
      ticker: l.ticker,
      price: n(l.price),
      change: n(l.change),
      change_percent: n(l.changePercent),
      previous_close: nn(l.previousClose),
      open: nn(l.open),
      high: nn(l.high),
      low: nn(l.low),
      volume: l.volume === null ? null : Number(l.volume),
      quoted_at: paraIso(l.quotedAt),
      stale,
      provenance: {
        source: l.source,
        fetched_at: paraIso(l.fetchedAt),
        license: l.license,
        source_ref: l.sourceRef,
      },
    };
  }

  async function lerDaBrapi(
    ticker: string,
    anterior: string | null,
  ): Promise<LiveQuote | null> {
    const c = await brapi.cotacao(ticker);
    if (!c) return null;
    const fetchedAt = agora().toISOString();
    const linha = {
      ticker,
      price: c.price,
      change: c.change,
      changePercent: c.changePercent,
      previousClose: c.previousClose,
      open: c.open,
      high: c.high,
      low: c.low,
      volume: c.volume,
      quotedAt: c.quotedAt,
      source: BRAPI_SOURCE,
      fetchedAt,
      license: BRAPI_LICENSE,
      sourceRef: `quote/${ticker}`,
    };

    await db.transaction(async (tx) => {
      await tx
        .insert(liveQuotes)
        .values(linha)
        .onConflictDoUpdate({ target: liveQuotes.ticker, set: linha });
      // Evento so quando o preco muda: reler o cache a cada minuto com o
      // mercado fechado nao e cotacao nova.
      if (anterior === null || !new Decimal(anterior).eq(c.price)) {
        await tx.insert(outbox).values(
          linhaDeOutbox({
            name: "marketdata.quote.updated.v1",
            producer: PRODUTOR,
            payload: { ticker, price: c.price, change: c.change, ts: c.quotedAt },
          }),
        );
      }
    });

    return deLinhaLive({ ...linha, fetchedAt }, false);
  }

  async function doFechamento(ticker: string): Promise<LiveQuote | null> {
    const ultimos = await db
      .select()
      .from(quotesDaily)
      .where(eq(quotesDaily.ticker, ticker))
      .orderBy(desc(quotesDaily.date))
      .limit(2);
    const [u, p] = ultimos;
    if (!u) return null;
    const change = p ? new Decimal(u.close).minus(p.close) : new Decimal(0);
    return {
      ticker,
      price: n(u.close),
      change: change.toFixed(),
      change_percent: p
        ? change.div(p.close).times(100).toDecimalPlaces(4).toFixed()
        : "0",
      previous_close: p ? n(p.close) : null,
      open: n(u.open),
      high: n(u.high),
      low: n(u.low),
      volume: Number(u.volume),
      quoted_at: `${u.date}T21:00:00.000Z`,
      stale: true,
      provenance: {
        source: u.source,
        fetched_at: paraIso(u.fetchedAt),
        license: u.license,
        source_ref: u.sourceRef,
      },
    };
  }

  async function cotacao(ticker: string): Promise<LiveQuote | null> {
    const [cache] = await db
      .select()
      .from(liveQuotes)
      .where(eq(liveQuotes.ticker, ticker));
    if (cache && dentroDoPrazo(cache.fetchedAt, config.quoteTtlMs, agora())) {
      return deLinhaLive(cache, false);
    }

    try {
      const fresca = await coalescedor.executar(`quote:${ticker}`, () =>
        lerDaBrapi(ticker, cache?.price ?? null),
      );
      if (fresca) return fresca;
    } catch (erro) {
      log("warn", "brapi falhou; servindo o ultimo valor conhecido", {
        ticker,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }
    if (cache) return deLinhaLive(cache, true);
    return doFechamento(ticker);
  }

  async function cotacoes(tickers: string[]): Promise<Resposta<LiveQuote[]>> {
    const unicos = [...new Set(tickers)];
    if (unicos.length > MAX_TICKERS_POR_CONSULTA) {
      throw new BolsiqError(
        "too_many_tickers",
        `no maximo ${MAX_TICKERS_POR_CONSULTA} tickers por consulta`,
      );
    }
    const resultados = (await Promise.all(unicos.map((t) => cotacao(t)))).filter(
      (c): c is LiveQuote => c !== null,
    );
    if (resultados.length === 0) naoEncontrado(`sem cotacao para ${unicos.join(",")}`);

    const fontes = [...new Set(resultados.map((r) => r.provenance.source))];
    const licencas = [...new Set(resultados.map((r) => r.provenance.license))];
    const daBrapi = resultados.every((r) => r.provenance.source === BRAPI_SOURCE);
    return {
      data: resultados,
      meta: {
        source: fontes.join("+"),
        fetched_at: resultados.map((r) => r.provenance.fetched_at).sort()[0] as string,
        license: licencas.join("; "),
        stale: resultados.some((r) => r.stale),
        delay_minutes: daBrapi ? config.brapiDelayMinutes : COTAHIST_DELAY_MINUTES,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Proventos: read-through da brapi
  // -------------------------------------------------------------------------

  async function atualizarProventos(ticker: string): Promise<boolean> {
    const lidos = await brapi.proventos(ticker);
    if (lidos === null) {
      // Cache negativo: sem token, a brapi recusa quase todo ticker. Sem isto
      // cada leitura de historico ajustado iria a fonte receber o mesmo 401.
      await marcarLeitura(SEM_PROVENTOS, ticker, "indisponivel", 0);
      return false;
    }

    const fetchedAt = agora().toISOString();
    const limiteDeAnuncio = somarDias(hoje(agora()), -JANELA_DE_ANUNCIO_DIAS);
    // Mesma chave pode vir duas vezes (dois JCP com a mesma data-ex): soma.
    const porChave = new Map<string, ProventoBrapi>();
    for (const p of lidos) {
      const chave = `${p.exDate}|${p.kind}`;
      const atual = porChave.get(chave);
      porChave.set(
        chave,
        atual && atual.valuePerShare && p.valuePerShare
          ? {
              ...atual,
              valuePerShare: new Decimal(atual.valuePerShare)
                .plus(p.valuePerShare)
                .toFixed(),
            }
          : p,
      );
    }
    const linhas = [...porChave.values()];

    await db.transaction(async (tx) => {
      if (linhas.length > 0) {
        const gravadas = await tx
          .insert(dividends)
          .values(
            linhas.map((p) => ({
              ticker,
              exDate: p.exDate,
              kind: p.kind,
              valuePerShare: p.valuePerShare,
              factor: p.factor,
              ratio: p.ratio,
              paymentDate: p.paymentDate,
              approvedOn: p.approvedOn,
              source: BRAPI_SOURCE,
              fetchedAt,
              license: BRAPI_LICENSE,
              sourceRef: `quote/${ticker}?dividends=true`,
            })),
          )
          .onConflictDoUpdate({
            target: [dividends.ticker, dividends.exDate, dividends.kind],
            set: {
              valuePerShare: sql`excluded.value_per_share`,
              factor: sql`excluded.factor`,
              ratio: sql`excluded.ratio`,
              paymentDate: sql`excluded.payment_date`,
              approvedOn: sql`excluded.approved_on`,
              fetchedAt: sql`excluded.fetched_at`,
            },
          })
          .returning({
            exDate: dividends.exDate,
            kind: dividends.kind,
            novo: sql<boolean>`(xmax = 0)`,
          });

        // Provento antigo na primeira leitura nao e anuncio: emitir 400
        // eventos do historico da PETR4 dispararia alerta de dividendo pago
        // ha dez anos.
        const anunciados = gravadas.filter((g) => g.novo && g.exDate >= limiteDeAnuncio);
        const eventos = anunciados.flatMap((g) => {
          const p = porChave.get(`${g.exDate}|${g.kind}`);
          if (!p) return [];
          return [
            linhaDeOutbox({
              name: "marketdata.dividend.announced.v1",
              producer: PRODUTOR,
              payload: {
                ticker,
                kind: p.kind,
                value_per_share: p.valuePerShare,
                ratio: p.ratio,
                ex_date: p.exDate,
                payment_date: p.paymentDate,
              },
            }),
          ];
        });
        if (eventos.length > 0) await tx.insert(outbox).values(eventos);
      }
    });
    await marcarLeitura("brapi-dividends", ticker, linhas, linhas.length);
    return true;
  }

  /** Garante proventos dentro do prazo; `false` quando a fonte falhou. */
  async function garantirProventos(
    ticker: string,
  ): Promise<{ ok: boolean; fetchedAt: string | null }> {
    const ultima = await ultimaLeitura("brapi-dividends", ticker);
    if (dentroDoPrazo(ultima, config.dividendsTtlMs, agora()))
      return { ok: true, fetchedAt: ultima };
    const recusa = await ultimaLeitura(SEM_PROVENTOS, ticker);
    if (dentroDoPrazo(recusa, config.dividendsTtlMs, agora()))
      return { ok: false, fetchedAt: ultima };
    try {
      const ok = await coalescedor.executar(`dividends:${ticker}`, () =>
        atualizarProventos(ticker),
      );
      return { ok, fetchedAt: ok ? agora().toISOString() : ultima };
    } catch (erro) {
      log("warn", "brapi falhou ao ler proventos", {
        ticker,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      return { ok: false, fetchedAt: ultima };
    }
  }

  async function proventos(
    ticker: string,
    q: { from?: string; to?: string },
  ): Promise<Resposta<Dividend[]>> {
    const leitura = await garantirProventos(ticker);
    const condicoes = [eq(dividends.ticker, ticker)];
    if (q.from) condicoes.push(gte(dividends.exDate, q.from));
    if (q.to) condicoes.push(lte(dividends.exDate, q.to));
    const linhas = await db
      .select()
      .from(dividends)
      .where(and(...condicoes))
      .orderBy(desc(dividends.exDate));

    if (linhas.length === 0 && !leitura.ok) {
      const [existe] = await db
        .select({ t: assets.ticker })
        .from(assets)
        .where(eq(assets.ticker, ticker));
      if (!existe) naoEncontrado(`ativo ${ticker} nao esta no universo`);
    }

    return {
      data: linhas.map((l) => ({
        ticker,
        kind: l.kind as Dividend["kind"],
        ex_date: l.exDate,
        payment_date: l.paymentDate,
        approved_on: l.approvedOn,
        value_per_share: nn(l.valuePerShare),
        factor: nn(l.factor),
        ratio: l.ratio,
      })),
      meta: {
        source: BRAPI_SOURCE,
        fetched_at: paraIso(leitura.fetchedAt ?? agora().toISOString()),
        license: BRAPI_LICENSE,
        stale: !leitura.ok,
        delay_minutes: 0,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Historico
  // -------------------------------------------------------------------------

  async function historico(
    ticker: string,
    q: { interval: Interval; from?: string; to?: string; adjusted: boolean },
  ) {
    const ate = q.to ?? hoje(agora());
    const de = q.from ?? umAnoAntes(ate);
    if (de > ate) throw new BolsiqError("validation_error", "from posterior a to");

    const linhas = await db
      .select()
      .from(quotesDaily)
      .where(
        and(
          eq(quotesDaily.ticker, ticker),
          gte(quotesDaily.date, de),
          lte(quotesDaily.date, ate),
        ),
      )
      .orderBy(asc(quotesDaily.date));

    if (linhas.length === 0) {
      const [existe] = await db
        .select({ t: assets.ticker })
        .from(assets)
        .where(eq(assets.ticker, ticker));
      if (!existe) naoEncontrado(`ativo ${ticker} nao esta no universo`);
    }

    let velas: Vela[] = linhas.map((l) => ({
      date: l.date,
      open: n(l.open),
      high: n(l.high),
      low: n(l.low),
      close: n(l.close),
      volume: Number(l.volume),
      financial_volume: n(l.financialVolume),
    }));

    let ajusteOk = true;
    if (q.adjusted && velas.length > 0) {
      const leitura = await garantirProventos(ticker);
      ajusteOk = leitura.ok;
      const eventos = await db
        .select()
        .from(dividends)
        .where(and(eq(dividends.ticker, ticker), sql`${dividends.exDate} > ${de}`));
      velas = ajustarPorProventos(
        velas,
        eventos.map((e): EventoDeAjuste => ({
          exDate: e.exDate,
          kind: e.kind as EventoDeAjuste["kind"],
          valuePerShare: e.valuePerShare,
          factor: e.factor,
        })),
      );
    }

    const ultima = linhas.at(-1);
    const esperado = ultimoPregaoEsperado(agora());
    const atrasado = ate >= esperado && (ultima?.date ?? "") < esperado;
    const maisRecente = linhas
      .map((l) => l.fetchedAt)
      .sort()
      .pop();

    return {
      data: {
        ticker,
        interval: q.interval,
        adjusted: q.adjusted,
        candles: agregarVelas(velas, q.interval),
      },
      meta: {
        source: q.adjusted ? `${COTAHIST_SOURCE}+${BRAPI_SOURCE}` : COTAHIST_SOURCE,
        fetched_at: paraIso(maisRecente ?? agora().toISOString()),
        license: q.adjusted ? `${COTAHIST_LICENSE}; ${BRAPI_LICENSE}` : COTAHIST_LICENSE,
        stale: atrasado || !ajusteOk,
        delay_minutes: COTAHIST_DELAY_MINUTES,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Fundamentos
  // -------------------------------------------------------------------------

  async function fundamentos(ticker: string, periodo: "annual" | "quarterly") {
    const [a] = await db
      .select({ cvmCode: assets.cvmCode, cnpj: assets.cnpj })
      .from(assets)
      .where(eq(assets.ticker, ticker));
    if (!a) naoEncontrado(`ativo ${ticker} nao esta no universo`);
    if (!a.cvmCode || !a.cnpj) naoEncontrado(`${ticker} nao tem companhia da CVM ligada`);

    const source = periodo === "annual" ? "cvm-dfp" : "cvm-itr";
    const linhas = await db
      .select({
        referenceDate: financialStatements.referenceDate,
        periodStart: financialStatements.periodStart,
        isConsolidated: financialStatements.isConsolidated,
        statementType: financialStatements.statementType,
        accountCode: financialStatements.accountCode,
        accountLabel: financialStatements.accountLabel,
        amount: financialStatements.amount,
        version: financialStatements.version,
        fetchedAt: financialStatements.fetchedAt,
      })
      .from(financialStatements)
      .where(
        and(
          eq(financialStatements.cvmCode, a.cvmCode),
          eq(financialStatements.source, source),
          or(
            inArray(financialStatements.accountCode, [
              "1",
              "1.01",
              "1.01.01",
              "2.01",
              "2.01.04",
              "2.02.01",
              "2.03",
              "3.01",
              "3.03",
              "3.05",
              "3.11",
            ]),
            like(financialStatements.accountCode, "6.01.01.%"),
          ),
        ),
      );

    const grupos = new Map<string, typeof linhas>();
    for (const l of linhas) {
      const chave = `${l.referenceDate}|${l.isConsolidated}`;
      grupos.set(chave, [...(grupos.get(chave) ?? []), l]);
    }

    const acoes = await db.select().from(shareCounts).where(eq(shareCounts.cnpj, a.cnpj));
    const acoesPorData = new Map(
      acoes.map((s) => [s.referenceDate, s.total - s.treasuryTotal]),
    );

    const datas = [...new Set(linhas.map((l) => l.referenceDate))].sort().reverse();
    const periods: FundamentalsPeriod[] = datas.map((data) => {
      // Consolidado quando existe: e o que importa para holding. Companhia sem
      // controlada so publica o individual.
      const consolidado = grupos.get(`${data}|true`);
      const escolhido = consolidado ?? grupos.get(`${data}|false`) ?? [];
      const resumo = resumirContas(escolhido.map((l) => ({ ...l, amount: n(l.amount) })));
      const dre = escolhido.filter((l) => l.statementType === "DRE");
      const inicio = dre
        .map((l) => l.periodStart)
        .filter((p): p is string => p !== null)
        .sort()
        .pop();
      const emCirculacao = acoesPorData.get(data);
      return {
        reference_date: data,
        period_start: inicio ?? null,
        statement_kind: periodo === "annual" ? "DFP" : "ITR",
        consolidated: consolidado !== undefined,
        ...resumo,
        shares_outstanding:
          emCirculacao !== undefined && emCirculacao > 0n ? Number(emCirculacao) : null,
        version: Math.max(...escolhido.map((l) => l.version)),
      };
    });

    const maisRecente = linhas
      .map((l) => l.fetchedAt)
      .sort()
      .pop();
    return {
      data: { ticker, cvm_code: a.cvmCode, cnpj: a.cnpj, period: periodo, periods },
      meta: {
        source,
        fetched_at: paraIso(maisRecente ?? agora().toISOString()),
        license: CVM_LICENSE,
        stale: false,
        delay_minutes: 0,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Macro: read-through do SGS; IBOV pela brapi ou pelo BOVA11
  // -------------------------------------------------------------------------

  async function garantirSerie(
    code: string,
    unit: string,
    frequency: string,
    de: string,
    ate: string,
  ) {
    const [limites] = await db
      .select({
        primeira: sql<string | null>`min(${macroSeries.date})::text`,
        ultima: sql<string | null>`max(${macroSeries.date})::text`,
      })
      .from(macroSeries)
      .where(eq(macroSeries.seriesCode, code));

    // Desde quando a fonte ja foi consultada. Sem isto, pedir 2015 de uma
    // serie que so comeca em 2016 iria a fonte a cada chamada atras do
    // intervalo que nao existe.
    const [cobertura] = await db
      .select({ desde: sql<string | null>`min(${fetchLog.contentHash})` })
      .from(fetchLog)
      .where(and(eq(fetchLog.source, COBERTURA_SGS), eq(fetchLog.sourceRef, code)));
    const jaConsultadoDesde = cobertura?.desde ?? null;

    const faltas: { de: string; ate: string }[] = [];
    if (!limites?.primeira || !limites.ultima) {
      if (!jaConsultadoDesde || jaConsultadoDesde > de) faltas.push({ de, ate });
    } else {
      if (de < limites.primeira && (!jaConsultadoDesde || jaConsultadoDesde > de)) {
        faltas.push({ de, ate: somarDias(limites.primeira, -1) });
      }
      if (ate > limites.ultima) {
        const ultimaLeituraFeita = await ultimaLeitura(BCB_SOURCE, code);
        // Fim de semana nao tem ponto novo: sem o prazo, toda consulta iria a
        // fonte perguntar pelo que ainda nao existe.
        if (!dentroDoPrazo(ultimaLeituraFeita, config.macroTtlMs, agora())) {
          faltas.push({ de: somarDias(limites.ultima, 1), ate });
        }
      }
    }

    for (const f of faltas) {
      if (f.de > f.ate) continue;
      await coalescedor.executar(`macro:${code}:${f.de}:${f.ate}`, async () => {
        const pontos = await bcb.serie(code, f.de, f.ate);
        await gravarSerieMacro(
          db,
          { code, unit, frequency, sourceRef: `bcdata.sgs.${code}` },
          pontos,
        );
        await marcarLeitura(
          BCB_SOURCE,
          code,
          { de: f.de, ate: f.ate, n: pontos.length },
          pontos.length,
        );
        await db
          .insert(fetchLog)
          .values({
            id: randomUUID(),
            source: COBERTURA_SGS,
            sourceRef: code,
            contentHash: f.de,
            status: "ok",
            fetchedAt: agora().toISOString(),
          })
          .onConflictDoNothing();
      });
    }
  }

  async function ibov(de: string, ate: string) {
    if (config.brapiComToken) {
      try {
        const ultima = await ultimaLeitura("brapi-ibov", "^BVSP");
        if (!dentroDoPrazo(ultima, config.macroTtlMs, agora())) {
          await coalescedor.executar("macro:ibov", async () => {
            const velas = await brapi.historico("^BVSP", "max");
            if (!velas) return;
            await gravarSerieMacro(
              db,
              {
                code: "ibov",
                unit: "pontos",
                frequency: "daily",
                sourceRef: "quote/^BVSP",
                source: BRAPI_SOURCE,
                license: BRAPI_LICENSE,
              },
              velas.map((v) => ({ date: v.date, value: v.close })),
            );
            await marcarLeitura("brapi-ibov", "^BVSP", velas.length, velas.length);
          });
        }
        const pontos = await db
          .select({
            date: macroSeries.date,
            value: macroSeries.value,
            fetchedAt: macroSeries.fetchedAt,
          })
          .from(macroSeries)
          .where(
            and(
              eq(macroSeries.seriesCode, "ibov"),
              gte(macroSeries.date, de),
              lte(macroSeries.date, ate),
            ),
          )
          .orderBy(asc(macroSeries.date));
        if (pontos.length > 0) {
          return {
            data: {
              series: "ibov" as const,
              unit: "pontos",
              frequency: "daily" as const,
              points: pontos.map(({ date, value }) => ({ date, value: n(value) })),
            },
            meta: {
              source: BRAPI_SOURCE,
              fetched_at: paraIso(
                pontos
                  .map((p) => p.fetchedAt)
                  .sort()
                  .pop() as string,
              ),
              license: BRAPI_LICENSE,
              stale: false,
              delay_minutes: config.brapiDelayMinutes,
            },
          };
        }
      } catch (erro) {
        log("warn", "IBOV pela brapi falhou; usando BOVA11", { erro: String(erro) });
      }
    }

    // Sem token da brapi, o indice nao tem fonte aberta: o SGS parou de
    // publicar o Ibovespa (serie 7) em 2019. O BOVA11 replica o indice e esta
    // no COTAHIST; serve de benchmark, com a unidade dizendo o que e.
    const pontos = await db
      .select({
        date: quotesDaily.date,
        value: quotesDaily.close,
        fetchedAt: quotesDaily.fetchedAt,
      })
      .from(quotesDaily)
      .where(
        and(
          eq(quotesDaily.ticker, PROXY_IBOV),
          gte(quotesDaily.date, de),
          lte(quotesDaily.date, ate),
        ),
      )
      .orderBy(asc(quotesDaily.date));
    return {
      data: {
        series: "ibov" as const,
        unit: `R$ por cota do ${PROXY_IBOV} (aproximacao do IBOV)`,
        frequency: "daily" as const,
        points: pontos.map(({ date, value }) => ({ date, value: n(value) })),
      },
      meta: {
        source: `${COTAHIST_SOURCE}:${PROXY_IBOV}`,
        fetched_at: paraIso(
          pontos
            .map((p) => p.fetchedAt)
            .sort()
            .pop() ?? agora().toISOString(),
        ),
        license: COTAHIST_LICENSE,
        stale:
          (pontos.at(-1)?.date ?? "") < ultimoPregaoEsperado(agora()) &&
          ate >= ultimoPregaoEsperado(agora()),
        delay_minutes: COTAHIST_DELAY_MINUTES,
      },
    };
  }

  async function macro(serie: MacroSeriesName, q: { from?: string; to?: string }) {
    const ate = q.to ?? hoje(agora());
    const de = q.from ?? umAnoAntes(ate);
    if (de > ate) throw new BolsiqError("validation_error", "from posterior a to");
    if (serie === "ibov") return ibov(de, ate);

    const def = SERIES_MACRO[serie];
    let stale = false;
    try {
      await garantirSerie(def.code, def.unit, def.frequency, de, ate);
    } catch (erro) {
      stale = true;
      log("warn", "SGS falhou; servindo o que ha no banco", {
        serie,
        erro: String(erro),
      });
    }

    const pontos = await db
      .select({
        date: macroSeries.date,
        value: macroSeries.value,
        fetchedAt: macroSeries.fetchedAt,
      })
      .from(macroSeries)
      .where(
        and(
          eq(macroSeries.seriesCode, def.code),
          gte(macroSeries.date, de),
          lte(macroSeries.date, ate),
        ),
      )
      .orderBy(asc(macroSeries.date));
    if (pontos.length === 0 && stale) {
      throw new BolsiqError("source_unavailable", "SGS do Banco Central indisponivel");
    }

    return {
      data: {
        series: serie,
        unit: def.unit,
        frequency: def.frequency,
        points: pontos.map(({ date, value }) => ({ date, value: n(value) })),
      },
      meta: {
        source: BCB_SOURCE,
        fetched_at: paraIso(
          pontos
            .map((p) => p.fetchedAt)
            .sort()
            .pop() ?? agora().toISOString(),
        ),
        license: BCB_LICENSE,
        stale,
        delay_minutes: 0,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Fundos: carga em lote pelo job cvm-fundos (ADR 0013)
  // -------------------------------------------------------------------------

  const META_FUNDOS = { source: "cvm-fundos", license: CVM_LICENSE };
  /** O informe diario sai com um a dois dias uteis de atraso. */
  const FUNDOS_DELAY_MINUTES = 2 * 24 * 60;

  async function buscarFundos(q: string): Promise<Resposta<FundSummary[]>> {
    const termo = q.trim();
    const digitos = termo.replace(/\D/g, "");
    const condicao =
      digitos.length >= 6 && /^[\d./-]+$/.test(termo)
        ? like(funds.cnpj, `${digitos}%`)
        : ilike(funds.name, `%${termo.replace(/[%_\\]/g, "")}%`);
    const linhas = await db
      .select()
      .from(funds)
      .where(condicao)
      .orderBy(
        sql`(${funds.status} = 'Em Funcionamento Normal') DESC`,
        sql`${funds.aum} DESC NULLS LAST`,
        asc(funds.name),
      )
      .limit(20);
    return {
      data: linhas.map((f) => ({
        cnpj: f.cnpj,
        name: f.name,
        class_type: f.classType,
        classification: f.classification,
        status: f.status,
      })),
      meta: {
        ...META_FUNDOS,
        fetched_at: paraIso(
          linhas
            .map((l) => l.fetchedAt)
            .sort()
            .pop() ?? agora().toISOString(),
        ),
        stale: false,
        delay_minutes: 0,
      },
    };
  }

  async function fundo(cnpj: string): Promise<Resposta<FundDetail>> {
    const [f] = await db.select().from(funds).where(eq(funds.cnpj, cnpj));
    if (!f) naoEncontrado(`fundo ${cnpj} nao esta no cadastro da CVM`);
    const provenance = {
      source: f.source,
      fetched_at: paraIso(f.fetchedAt),
      license: f.license,
      source_ref: f.sourceRef,
    };
    return {
      data: {
        cnpj: f.cnpj,
        name: f.name,
        class_type: f.classType,
        classification: f.classification,
        status: f.status,
        anbima_class: f.anbimaClass,
        aum: nn(f.aum),
        aum_date: f.aumDate,
        provenance,
      },
      meta: {
        ...META_FUNDOS,
        fetched_at: provenance.fetched_at,
        stale: false,
        delay_minutes: 0,
      },
    };
  }

  async function historicoDeFundo(cnpj: string, q: { from?: string; to?: string }) {
    const ate = q.to ?? hoje(agora());
    const de = q.from ?? umAnoAntes(ate);
    if (de > ate) throw new BolsiqError("validation_error", "from posterior a to");
    const linhas = await db
      .select({
        date: fundDaily.date,
        nav: fundDaily.nav,
        aum: fundDaily.aum,
        holders: fundDaily.holders,
        fetchedAt: fundDaily.fetchedAt,
      })
      .from(fundDaily)
      .where(
        and(
          eq(fundDaily.cnpjFundo, cnpj),
          gte(fundDaily.date, de),
          lte(fundDaily.date, ate),
        ),
      )
      .orderBy(asc(fundDaily.date));
    if (linhas.length === 0) {
      const [existe] = await db
        .select({ c: funds.cnpj })
        .from(funds)
        .where(eq(funds.cnpj, cnpj));
      if (!existe) naoEncontrado(`fundo ${cnpj} nao esta no cadastro da CVM`);
    }
    const ultima = linhas.at(-1)?.date ?? "";
    return {
      data: {
        cnpj,
        points: linhas.map((l) => ({
          date: l.date,
          nav: n(l.nav),
          aum: n(l.aum),
          holders: l.holders,
        })),
      },
      meta: {
        ...META_FUNDOS,
        fetched_at: paraIso(
          linhas
            .map((l) => l.fetchedAt)
            .sort()
            .pop() ?? agora().toISOString(),
        ),
        // Mais de uma semana sem cota com o periodo chegando a hoje: carga atrasada.
        stale:
          ate >= somarDias(hoje(agora()), -1) && ultima < somarDias(hoje(agora()), -7),
        delay_minutes: FUNDOS_DELAY_MINUTES,
      },
    };
  }

  // -------------------------------------------------------------------------
  // FIIs: informe mensal, carga em lote pelo job cvm-fii-mensal
  // -------------------------------------------------------------------------

  /** O informe do mes sai ate 15 dias depois do fim do mes. */
  const INFORME_FII_DELAY_MINUTES = 45 * 24 * 60;

  async function informesFii(ticker: string, q: { from?: string; to?: string }) {
    const ate = q.to ?? hoje(agora());
    const de = q.from ?? umAnoAntes(umAnoAntes(ate));
    if (de > ate) throw new BolsiqError("validation_error", "from posterior a to");
    const [a] = await db
      .select({ cnpj: assets.cnpj, kind: assets.kind })
      .from(assets)
      .where(eq(assets.ticker, ticker));
    if (!a) naoEncontrado(`ativo ${ticker} nao esta no universo`);
    if (a.kind !== "fii" || !a.cnpj)
      naoEncontrado(`${ticker} nao tem informe mensal de FII ligado`);

    const linhas = await db
      .select()
      .from(fiiMonthly)
      .where(
        and(
          eq(fiiMonthly.cnpj, a.cnpj),
          gte(fiiMonthly.referenceDate, de),
          lte(fiiMonthly.referenceDate, ate),
        ),
      )
      .orderBy(asc(fiiMonthly.referenceDate));
    const [ultimo] =
      linhas.length > 0
        ? linhas.slice(-1)
        : await db
            .select()
            .from(fiiMonthly)
            .where(eq(fiiMonthly.cnpj, a.cnpj))
            .orderBy(desc(fiiMonthly.referenceDate))
            .limit(1);
    if (!ultimo) naoEncontrado(`${ticker} nao tem informe mensal de FII ligado`);

    const fetchedAt = paraIso(
      linhas
        .map((l) => l.fetchedAt)
        .sort()
        .pop() ?? ultimo.fetchedAt,
    );
    return {
      data: {
        ticker,
        cnpj: a.cnpj,
        name: ultimo.name,
        segment: ultimo.segment,
        reports: linhas.map((l) => ({
          reference_date: l.referenceDate,
          version: l.version,
          total_assets: nn(l.totalAssets),
          equity: nn(l.equity),
          shares_outstanding: nn(l.sharesOutstanding),
          nav_per_share: nn(l.navPerShare),
          holders: l.holders,
          dividend_yield_month: nn(l.dividendYieldMonth),
          effective_return_month: nn(l.effectiveReturnMonth),
          amortization_month: nn(l.amortizationMonth),
          dividends_payable: nn(l.dividendsPayable),
          provenance: {
            source: l.source,
            fetched_at: paraIso(l.fetchedAt),
            license: l.license,
            source_ref: l.sourceRef,
          },
        })),
      },
      meta: {
        source: "cvm-fii-mensal",
        fetched_at: fetchedAt,
        license: CVM_LICENSE,
        // Competencia mais recente com mais de tres meses: carga atrasada.
        stale:
          ate >= somarDias(hoje(agora()), -1) &&
          ultimo.referenceDate < somarDias(hoje(agora()), -100),
        delay_minutes: INFORME_FII_DELAY_MINUTES,
      },
    };
  }

  return {
    buscarAtivos,
    ativo,
    cotacoes,
    historico,
    proventos,
    fundamentos,
    buscarFundos,
    fundo,
    historicoDeFundo,
    informesFii,
    macro,
  };
}
