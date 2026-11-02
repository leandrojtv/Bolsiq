import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import {
  assets,
  financialStatements,
  macroSeries,
  outbox,
  quotesDaily,
  shareCounts,
  type Db,
} from "@bolsiq/db-core";
import { linhaDeOutbox, type Tx } from "@bolsiq/messaging";
import { Decimal } from "decimal.js";
import {
  COTAHIST_LICENSE,
  COTAHIST_SOURCE,
  type ArquivoCotahist,
  type RegistroDoUniverso,
} from "../fontes/b3-cotahist.js";
import { BCB_LICENSE, BCB_SOURCE, type PontoBcb } from "../fontes/bcb.js";
import {
  CVM_LICENSE,
  type CvmAdapter,
  type LinhaDeDemonstrativo,
} from "../fontes/cvm.js";
import { abrirCarga, concluirCarga, falharCarga } from "./carga.js";

export const PRODUTOR = "market-data";
const LOTE = 2000;

export type Log = (nivel: "info" | "warn" | "error", msg: string, ctx?: object) => void;

export interface ResultadoDeCarga {
  pulado: boolean;
  linhas: number;
  eventos: number;
}

function agoraIso(): string {
  return new Date().toISOString();
}

function lotes<T>(itens: T[], tamanho: number): T[][] {
  const saida: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) saida.push(itens.slice(i, i + tamanho));
  return saida;
}

// ---------------------------------------------------------------------------
// COTAHIST
// ---------------------------------------------------------------------------

interface ResumoDoTicker {
  ultimo: RegistroDoUniverso;
  primeiraData: string;
}

/**
 * Grava um arquivo do COTAHIST em `quotes_daily` e atualiza o universo.
 *
 * `diario`: alem de gravar, emite `quote.updated` para cada papel do pregao e
 * `daily.closed` no fim. A carga anual (historica) nao emite cotacao: 500 mil
 * eventos de preco antigo disparariam alerta de preco que ja passou.
 */
export async function carregarCotahist(
  db: Db,
  arquivo: ArquivoCotahist,
  opcoes: { diario: boolean; log: Log },
): Promise<ResultadoDeCarga & { ultimaData: string | null }> {
  const carga = await abrirCarga(db, { source: COTAHIST_SOURCE, ...arquivo });
  if (carga.jaCarregado) return { pulado: true, linhas: 0, eventos: 0, ultimaData: null };

  try {
    const fetchedAt = agoraIso();
    const porTicker = new Map<string, ResumoDoTicker>();
    let buffer: (typeof quotesDaily.$inferInsert)[] = [];
    let linhas = 0;
    let ultimaData: string | null = null;

    const gravar = async () => {
      if (buffer.length === 0) return;
      await db
        .insert(quotesDaily)
        .values(buffer)
        .onConflictDoUpdate({
          target: [quotesDaily.ticker, quotesDaily.date],
          set: {
            open: sql`excluded.open`,
            high: sql`excluded.high`,
            low: sql`excluded.low`,
            close: sql`excluded.close`,
            average: sql`excluded.average`,
            volume: sql`excluded.volume`,
            trades: sql`excluded.trades`,
            financialVolume: sql`excluded.financial_volume`,
            quoteFactor: sql`excluded.quote_factor`,
            fetchedAt: sql`excluded.fetched_at`,
            sourceRef: sql`excluded.source_ref`,
          },
        });
      linhas += buffer.length;
      buffer = [];
    };

    for await (const r of arquivo.registros()) {
      buffer.push({
        ticker: r.ticker,
        date: r.date,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        average: r.average,
        volume: r.volume,
        trades: r.trades,
        financialVolume: r.financialVolume,
        quoteFactor: r.quoteFactor,
        source: COTAHIST_SOURCE,
        fetchedAt,
        license: COTAHIST_LICENSE,
        sourceRef: arquivo.sourceRef,
      });
      const resumo = porTicker.get(r.ticker);
      if (!resumo) porTicker.set(r.ticker, { ultimo: r, primeiraData: r.date });
      else if (r.date >= resumo.ultimo.date) resumo.ultimo = r;
      if (ultimaData === null || r.date > ultimaData) ultimaData = r.date;
      if (buffer.length >= LOTE) await gravar();
    }
    await gravar();

    let eventos = 0;
    await db.transaction(async (tx) => {
      eventos += await atualizarUniverso(tx, porTicker, arquivo.sourceRef, fetchedAt);
      if (opcoes.diario && ultimaData) {
        eventos += await emitirFechamento(tx, porTicker, ultimaData);
      }
      await concluirCarga(tx, carga, linhas);
    });

    opcoes.log("info", "COTAHIST carregado", {
      arquivo: arquivo.sourceRef,
      linhas,
      papeis: porTicker.size,
      eventos,
    });
    return { pulado: false, linhas, eventos, ultimaData };
  } catch (erro) {
    await falharCarga(db, carga, erro);
    throw erro;
  }
}

/** Upsert do universo; papel novo emite `asset.listed`. */
async function atualizarUniverso(
  tx: Tx,
  porTicker: Map<string, ResumoDoTicker>,
  sourceRef: string,
  fetchedAt: string,
): Promise<number> {
  let eventos = 0;
  for (const lote of lotes([...porTicker.values()], 500)) {
    const inseridos = await tx
      .insert(assets)
      .values(
        lote.map(({ ultimo: r }) => ({
          id: r.ticker,
          ticker: r.ticker,
          isin: r.isin || null,
          name: r.shortName,
          kind: r.kind,
          source: COTAHIST_SOURCE,
          fetchedAt,
          license: COTAHIST_LICENSE,
          sourceRef,
        })),
      )
      .onConflictDoUpdate({
        target: assets.id,
        set: {
          isin: sql`excluded.isin`,
          name: sql`excluded.name`,
          kind: sql`excluded.kind`,
          updatedAt: sql`now()`,
        },
      })
      // xmax = 0 so na linha recem-inserida: e assim que o upsert diz quem e novo.
      .returning({ ticker: assets.ticker, novo: sql<boolean>`(xmax = 0)` });

    const novos = new Set(inseridos.filter((i) => i.novo).map((i) => i.ticker));
    const linhasDeEvento = lote
      .filter(({ ultimo }) => novos.has(ultimo.ticker))
      .map(({ ultimo: r, primeiraData }) =>
        linhaDeOutbox({
          name: "marketdata.asset.listed.v1",
          producer: PRODUTOR,
          payload: {
            ticker: r.ticker,
            isin: /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(r.isin) ? r.isin : null,
            kind: r.kind,
            name: r.shortName || r.ticker,
            listed_at: primeiraData,
          },
        }),
      );
    if (linhasDeEvento.length > 0) await tx.insert(outbox).values(linhasDeEvento);
    eventos += linhasDeEvento.length;
  }
  return eventos;
}

/** `quote.updated` de cada papel do pregao e `daily.closed` no fim. */
async function emitirFechamento(
  tx: Tx,
  porTicker: Map<string, ResumoDoTicker>,
  data: string,
): Promise<number> {
  const doDia = [...porTicker.values()].filter((t) => t.ultimo.date === data);
  const anteriores = new Map<string, string>();

  for (const lote of lotes(doDia, 500)) {
    const tickers = lote.map((t) => t.ultimo.ticker);
    const linhas = await tx
      .selectDistinctOn([quotesDaily.ticker], {
        ticker: quotesDaily.ticker,
        close: quotesDaily.close,
      })
      .from(quotesDaily)
      .where(and(inArray(quotesDaily.ticker, tickers), lt(quotesDaily.date, data)))
      .orderBy(quotesDaily.ticker, desc(quotesDaily.date));
    for (const l of linhas) anteriores.set(l.ticker, l.close);
  }

  const ts = `${data}T21:00:00Z`;
  const eventos = doDia.map(({ ultimo: r }) => {
    const anterior = anteriores.get(r.ticker);
    return linhaDeOutbox({
      name: "marketdata.quote.updated.v1",
      producer: PRODUTOR,
      payload: {
        ticker: r.ticker,
        price: r.close,
        change: anterior ? new Decimal(r.close).minus(anterior).toFixed() : "0",
        ts,
      },
    });
  });
  eventos.push(
    linhaDeOutbox({
      name: "marketdata.daily.closed.v1",
      producer: PRODUTOR,
      payload: { date: data, assets_updated: doDia.length },
    }),
  );

  for (const lote of lotes(eventos, 1000)) await tx.insert(outbox).values(lote);
  return eventos.length;
}

/** `daily.closed` avulso, usado no fim do backfill. */
export async function emitirDiaFechado(db: Db): Promise<string | null> {
  const [ultimo] = await db
    .select({ date: quotesDaily.date, n: sql<number>`count(*)::int` })
    .from(quotesDaily)
    .groupBy(quotesDaily.date)
    .orderBy(desc(quotesDaily.date))
    .limit(1);
  if (!ultimo) return null;
  await db.insert(outbox).values(
    linhaDeOutbox({
      name: "marketdata.daily.closed.v1",
      producer: PRODUTOR,
      payload: { date: ultimo.date, assets_updated: ultimo.n },
    }),
  );
  return ultimo.date;
}

// ---------------------------------------------------------------------------
// CVM: cadastro e ligacao ticker -> companhia
// ---------------------------------------------------------------------------

/**
 * Liga os tickers do universo as companhias da CVM.
 *
 * O cadastro identifica a companhia; o FCA diz quais tickers ela tem. Os dois
 * juntos preenchem `cnpj`, `cvm_code` e setor dos papeis que o COTAHIST criou.
 */
export async function carregarCadastro(
  db: Db,
  cvm: CvmAdapter,
  opcoes: { ano: number; log: Log },
): Promise<ResultadoDeCarga> {
  const { arquivo, companhias } = await cvm.cadastro();
  const carga = await abrirCarga(db, {
    source: "cvm-cadastro",
    sourceRef: "cad_cia_aberta.csv",
    sha256: arquivo.sha256,
    bytes: arquivo.bytes,
  });

  try {
    const valores =
      (await cvm.valoresMobiliarios(opcoes.ano)) ??
      (await cvm.valoresMobiliarios(opcoes.ano - 1)) ??
      [];
    const porCnpj = new Map(companhias.map((c) => [c.cnpj, c]));
    const fetchedAt = agoraIso();

    const ligacoes = valores.flatMap((v) => {
      const c = porCnpj.get(v.cnpj);
      return c ? [{ ticker: v.ticker, c }] : [];
    });

    let linhas = 0;
    for (const lote of lotes(ligacoes, 500)) {
      const valoresSql = sql.join(
        lote.map(
          ({ ticker, c }) =>
            sql`(${ticker}, ${c.cnpj}, ${c.cvmCode}, ${c.legalName}, ${c.sector}, ${c.status}, ${c.ownershipType}, ${c.registeredAt}::date)`,
        ),
        sql`, `,
      );
      const r = await db.execute(sql`
        UPDATE market_data.assets a SET
          cnpj = v.cnpj, cvm_code = v.cvm_code, legal_name = v.legal_name,
          sector = v.sector, status = v.status, ownership_type = v.ownership_type,
          registered_at = v.registered_at, updated_at = now()
        FROM (VALUES ${valoresSql}) AS v(ticker, cnpj, cvm_code, legal_name, sector, status, ownership_type, registered_at)
        WHERE a.ticker = v.ticker`);
      linhas += r.rowCount ?? 0;
    }

    await concluirCarga(db, carga, linhas);
    opcoes.log("info", "cadastro da CVM carregado", {
      companhias: companhias.length,
      tickers: valores.length,
      ativosLigados: linhas,
      fetchedAt,
    });
    return { pulado: false, linhas, eventos: 0 };
  } catch (erro) {
    await falharCarga(db, carga, erro);
    throw erro;
  }
}

// ---------------------------------------------------------------------------
// CVM: DFP e ITR
// ---------------------------------------------------------------------------

function chaveDaConta(l: LinhaDeDemonstrativo): string {
  return [
    l.cvmCode,
    l.referenceDate,
    l.statementType,
    l.isConsolidated,
    l.accountCode,
  ].join("|");
}

/**
 * Qual de duas linhas com a mesma chave vale.
 *
 * Maior VERSAO primeiro. Na mesma versao, o periodo mais curto: o ITR traz a
 * DRE do trimestre e a acumulada no ano com a mesma conta e data-base, e a
 * visao trimestral quer o trimestre. A mesma regra esta no WHERE do upsert,
 * para o resultado nao depender de em qual lote cada linha caiu.
 */
export function preferir(
  a: LinhaDeDemonstrativo,
  b: LinhaDeDemonstrativo,
): LinhaDeDemonstrativo {
  if (a.version !== b.version) return a.version > b.version ? a : b;
  return (b.periodStart ?? "") > (a.periodStart ?? "") ? b : a;
}

export async function carregarDemonstracoes(
  db: Db,
  cvm: CvmAdapter,
  opcoes: { tipo: "DFP" | "ITR"; ano: number; log: Log },
): Promise<ResultadoDeCarga> {
  const arquivo = await cvm.demonstracoes(opcoes.tipo, opcoes.ano);
  if (!arquivo) return { pulado: true, linhas: 0, eventos: 0 };

  const source = opcoes.tipo === "DFP" ? "cvm-dfp" : "cvm-itr";
  const carga = await abrirCarga(db, { source, ...arquivo });
  if (carga.jaCarregado) return { pulado: true, linhas: 0, eventos: 0 };

  try {
    const fetchedAt = agoraIso();
    const mudaram = new Set<string>();
    const vistos = new Set<string>();
    let buffer = new Map<string, LinhaDeDemonstrativo>();
    let linhas = 0;

    const gravar = async () => {
      if (buffer.size === 0) return;
      const valores = [...buffer.values()].map((l) => ({
        cvmCode: l.cvmCode,
        cnpj: l.cnpj,
        referenceDate: l.referenceDate,
        periodStart: l.periodStart,
        periodEnd: l.periodEnd,
        statementType: l.statementType,
        isConsolidated: l.isConsolidated,
        accountCode: l.accountCode,
        accountLabel: l.accountLabel,
        amount: l.amount,
        currency: l.currency,
        version: l.version,
        source,
        fetchedAt,
        license: CVM_LICENSE,
        sourceRef: l.sourceRef,
      }));
      buffer = new Map();

      const gravadas = await db
        .insert(financialStatements)
        .values(valores)
        .onConflictDoUpdate({
          target: [
            financialStatements.cvmCode,
            financialStatements.referenceDate,
            financialStatements.statementType,
            financialStatements.isConsolidated,
            financialStatements.accountCode,
          ],
          set: {
            periodStart: sql`excluded.period_start`,
            periodEnd: sql`excluded.period_end`,
            accountLabel: sql`excluded.account_label`,
            amount: sql`excluded.amount`,
            version: sql`excluded.version`,
            source: sql`excluded.source`,
            fetchedAt: sql`excluded.fetched_at`,
            sourceRef: sql`excluded.source_ref`,
          },
          setWhere: sql`excluded.version > ${financialStatements.version}
            OR (excluded.version = ${financialStatements.version}
                AND coalesce(excluded.period_start, '0001-01-01') > coalesce(${financialStatements.periodStart}, '0001-01-01'))
            OR (excluded.version = ${financialStatements.version}
                AND excluded.period_start IS NOT DISTINCT FROM ${financialStatements.periodStart}
                AND excluded.amount <> ${financialStatements.amount})`,
        })
        .returning({
          cvmCode: financialStatements.cvmCode,
          referenceDate: financialStatements.referenceDate,
        });
      for (const g of gravadas) mudaram.add(`${g.cvmCode}|${g.referenceDate}`);
      linhas += valores.length;
    };

    for await (const l of arquivo.linhas()) {
      vistos.add(`${l.cvmCode}|${l.referenceDate}`);
      const chave = chaveDaConta(l);
      const atual = buffer.get(chave);
      buffer.set(chave, atual ? preferir(atual, l) : l);
      if (buffer.size >= LOTE) await gravar();
    }
    await gravar();

    let acoes = 0;
    let lote: (typeof shareCounts.$inferInsert)[] = [];
    const gravarAcoes = async () => {
      if (lote.length === 0) return;
      await db
        .insert(shareCounts)
        .values(lote)
        .onConflictDoUpdate({
          target: [shareCounts.cnpj, shareCounts.referenceDate],
          set: {
            common: sql`excluded.common`,
            preferred: sql`excluded.preferred`,
            total: sql`excluded.total`,
            treasuryTotal: sql`excluded.treasury_total`,
            version: sql`excluded.version`,
            fetchedAt: sql`excluded.fetched_at`,
          },
          setWhere: sql`excluded.version >= ${shareCounts.version}`,
        });
      acoes += lote.length;
      lote = [];
    };
    const composicaoVista = new Set<string>();
    for await (const c of arquivo.composicao()) {
      const chave = `${c.cnpj}|${c.referenceDate}`;
      if (composicaoVista.has(chave)) continue;
      composicaoVista.add(chave);
      lote.push({
        ...c,
        source,
        fetchedAt,
        license: CVM_LICENSE,
        sourceRef: arquivo.sourceRef,
      });
      if (lote.length >= 1000) await gravarAcoes();
    }
    await gravarAcoes();

    const publicar = carga.recuperacao ? vistos : mudaram;
    let eventos = 0;
    await db.transaction(async (tx) => {
      eventos = await emitirDemonstracoes(tx, publicar, opcoes.tipo);
      await concluirCarga(tx, carga, linhas);
    });

    opcoes.log("info", `${opcoes.tipo} carregado`, {
      arquivo: arquivo.sourceRef,
      linhas,
      acoes,
      demonstrativos: vistos.size,
      eventos,
    });
    return { pulado: false, linhas, eventos };
  } catch (erro) {
    await falharCarga(db, carga, erro);
    throw erro;
  }
}

async function emitirDemonstracoes(
  tx: Tx,
  chaves: Set<string>,
  tipo: "DFP" | "ITR",
): Promise<number> {
  if (chaves.size === 0) return 0;
  const pares = [...chaves].map((c) => {
    const [cvmCode = "", referenceDate = ""] = c.split("|");
    return { cvmCode, referenceDate };
  });

  const codigos = [...new Set(pares.map((p) => p.cvmCode))];
  const tickersPorCodigo = new Map<string, string[]>();
  for (const lote of lotes(codigos, 1000)) {
    const linhas = await tx
      .select({ cvmCode: assets.cvmCode, ticker: assets.ticker })
      .from(assets)
      .where(inArray(assets.cvmCode, lote));
    for (const l of linhas) {
      if (!l.cvmCode || !l.ticker) continue;
      tickersPorCodigo.set(l.cvmCode, [
        ...(tickersPorCodigo.get(l.cvmCode) ?? []),
        l.ticker,
      ]);
    }
  }

  const eventos = pares.map((p) =>
    linhaDeOutbox({
      name: "marketdata.statement.published.v1",
      producer: PRODUTOR,
      payload: {
        cvm_code: p.cvmCode,
        tickers: (tickersPorCodigo.get(p.cvmCode) ?? []).sort(),
        period_end: p.referenceDate,
        statement_kind: tipo,
      },
    }),
  );
  for (const lote of lotes(eventos, 1000)) await tx.insert(outbox).values(lote);
  return eventos.length;
}

// ---------------------------------------------------------------------------
// BCB SGS
// ---------------------------------------------------------------------------

export async function gravarSerieMacro(
  db: Db,
  serie: {
    code: string;
    unit: string;
    frequency: string;
    sourceRef: string;
    source?: string;
    license?: string;
  },
  pontos: PontoBcb[],
): Promise<number> {
  const fetchedAt = agoraIso();
  for (const lote of lotes(pontos, LOTE)) {
    await db
      .insert(macroSeries)
      .values(
        lote.map((p) => ({
          seriesCode: serie.code,
          date: p.date,
          value: p.value,
          unit: serie.unit,
          frequency: serie.frequency,
          source: serie.source ?? BCB_SOURCE,
          fetchedAt,
          license: serie.license ?? BCB_LICENSE,
          sourceRef: serie.sourceRef,
        })),
      )
      .onConflictDoUpdate({
        target: [macroSeries.seriesCode, macroSeries.date],
        set: { value: sql`excluded.value`, fetchedAt: sql`excluded.fetched_at` },
      });
  }
  return pontos.length;
}

/** Ultima data gravada de uma serie, para o read-through pedir so o que falta. */
export async function ultimaDataDaSerie(db: Db, code: string): Promise<string | null> {
  const [r] = await db
    .select({ date: macroSeries.date })
    .from(macroSeries)
    .where(eq(macroSeries.seriesCode, code))
    .orderBy(desc(macroSeries.date))
    .limit(1);
  return r?.date ?? null;
}
