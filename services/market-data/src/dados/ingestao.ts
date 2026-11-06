import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  assets,
  fetchLog,
  financialStatements,
  fiiMonthly,
  fundDaily,
  funds,
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
  refDoDia,
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

/**
 * Quantas vezes um dia util tem de responder 404 antes de ser aceito como dia
 * sem pregao.
 *
 * Feriado e arquivo que ainda nao saiu respondem 404 igual, e a B3 nao publica
 * o calendario de pregao em formato consumivel. A diferenca aparece no tempo:
 * o arquivo atrasado existe na varredura seguinte, o feriado nunca. Ate este
 * limite, o dia continua sendo pedido.
 */
const TENTATIVAS_SEM_PREGAO = 3;
const SEM_PREGAO = "sem-pregao";

/** Registra o 404 do dia e devolve quantas tentativas ele ja acumulou. */
export async function marcarSemPregao(db: Db, data: string): Promise<number> {
  const [linha] = await db
    .insert(fetchLog)
    .values({
      id: randomUUID(),
      source: COTAHIST_SOURCE,
      sourceRef: refDoDia(data),
      contentHash: SEM_PREGAO,
      status: SEM_PREGAO,
      fetchedAt: agoraIso(),
    })
    .onConflictDoUpdate({
      target: [fetchLog.source, fetchLog.sourceRef, fetchLog.contentHash],
      set: { attempts: sql`${fetchLog.attempts} + 1`, fetchedAt: agoraIso() },
    })
    .returning({ attempts: fetchLog.attempts });
  return linha?.attempts ?? 1;
}

function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Dias uteis dos ultimos `dias` que nao tem nada em `quotes_daily` e ainda nao
 * esgotaram as tentativas de 404.
 *
 * O dia corrente fica de fora: o COTAHIST dele sai a noite, e cobra-lo aqui
 * geraria 404 em todo pregao.
 */
export async function diasSemCotahist(
  db: Db,
  hoje: string,
  dias: number,
): Promise<string[]> {
  const candidatos: string[] = [];
  for (let i = 1; i <= dias; i++) {
    const data = somarDias(hoje, -i);
    const semana = new Date(`${data}T00:00:00Z`).getUTCDay();
    if (semana !== 0 && semana !== 6) candidatos.push(data);
  }
  if (candidatos.length === 0) return [];

  const comDados = await db
    .selectDistinct({ date: quotesDaily.date })
    .from(quotesDaily)
    .where(inArray(quotesDaily.date, candidatos));
  const carregados = new Set(comDados.map((r) => r.date));

  const marcados = await db
    .select({ sourceRef: fetchLog.sourceRef })
    .from(fetchLog)
    .where(
      and(
        eq(fetchLog.source, COTAHIST_SOURCE),
        eq(fetchLog.status, SEM_PREGAO),
        gte(fetchLog.attempts, TENTATIVAS_SEM_PREGAO),
      ),
    );
  const semPregao = new Set(marcados.map((r) => r.sourceRef));

  return candidatos
    .filter((d) => !carregados.has(d) && !semPregao.has(refDoDia(d)))
    .sort();
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

// ---------------------------------------------------------------------------
// CVM: fundos
// ---------------------------------------------------------------------------

/** Cadastro das classes de fundo. Upsert: o arquivo e o retrato atual. */
export async function carregarCadastroDeFundos(
  db: Db,
  cvm: CvmAdapter,
  opcoes: { log: Log },
): Promise<ResultadoDeCarga> {
  const cadastro = await cvm.cadastroDeFundos();
  if (!cadastro) return { pulado: true, linhas: 0, eventos: 0 };
  const carga = await abrirCarga(db, {
    source: "cvm-fundos-cadastro",
    sourceRef: "registro_fundo_classe.zip",
    sha256: cadastro.arquivo.sha256,
    bytes: cadastro.arquivo.bytes,
  });
  if (carga.jaCarregado) return { pulado: true, linhas: 0, eventos: 0 };

  try {
    const fetchedAt = agoraIso();
    let linhas = 0;
    let buffer: (typeof funds.$inferInsert)[] = [];
    const gravar = async () => {
      if (buffer.length === 0) return;
      // O registro repete a classe quando ela muda de fundo: vale a ultima.
      const unicos = [...new Map(buffer.map((f) => [f.cnpj, f])).values()];
      await db
        .insert(funds)
        .values(unicos)
        .onConflictDoUpdate({
          target: funds.cnpj,
          set: {
            name: sql`excluded.name`,
            classType: sql`excluded.class_type`,
            classification: sql`excluded.classification`,
            anbimaClass: sql`excluded.anbima_class`,
            status: sql`excluded.status`,
            aum: sql`excluded.aum`,
            aumDate: sql`excluded.aum_date`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
      linhas += unicos.length;
      buffer = [];
    };
    for await (const c of cadastro.classes()) {
      buffer.push({
        ...c,
        source: "cvm-fundos",
        fetchedAt,
        license: CVM_LICENSE,
        sourceRef: "registro_fundo_classe.zip#registro_classe.csv",
      });
      if (buffer.length >= LOTE) await gravar();
    }
    await gravar();
    await concluirCarga(db, carga, linhas);
    opcoes.log("info", "cadastro de fundos carregado", { classes: linhas });
    return { pulado: false, linhas, eventos: 0 };
  } catch (erro) {
    await falharCarga(db, carga, erro);
    throw erro;
  }
}

/**
 * Informe diario de um mes em `fund_daily`.
 *
 * O arquivo do mes corrente cresce todo dia: o hash muda e ele e recarregado
 * (correto); meses fechados nao mudam e sao pulados.
 */
export async function carregarInformeDiario(
  db: Db,
  cvm: CvmAdapter,
  opcoes: { aaaamm: string; log: Log },
): Promise<ResultadoDeCarga> {
  const arquivo = await cvm.informeDiario(opcoes.aaaamm);
  if (!arquivo) return { pulado: true, linhas: 0, eventos: 0 };
  const carga = await abrirCarga(db, { source: "cvm-fundos", ...arquivo });
  if (carga.jaCarregado) return { pulado: true, linhas: 0, eventos: 0 };

  try {
    const fetchedAt = agoraIso();
    let linhas = 0;
    let buffer = new Map<string, typeof fundDaily.$inferInsert>();
    const gravar = async () => {
      if (buffer.size === 0) return;
      const valores = [...buffer.values()];
      buffer = new Map();
      await db
        .insert(fundDaily)
        .values(valores)
        .onConflictDoUpdate({
          target: [fundDaily.cnpjFundo, fundDaily.date],
          set: {
            nav: sql`excluded.nav`,
            aum: sql`excluded.aum`,
            inflows: sql`excluded.inflows`,
            outflows: sql`excluded.outflows`,
            holders: sql`excluded.holders`,
            totalPortfolio: sql`excluded.total_portfolio`,
            fetchedAt: sql`excluded.fetched_at`,
            sourceRef: sql`excluded.source_ref`,
          },
        });
      linhas += valores.length;
    };
    for await (const c of arquivo.cotas()) {
      buffer.set(`${c.cnpj}|${c.date}`, {
        cnpjFundo: c.cnpj,
        date: c.date,
        nav: c.nav,
        aum: c.aum,
        inflows: c.inflows,
        outflows: c.outflows,
        holders: c.holders,
        totalPortfolio: c.totalPortfolio,
        source: "cvm-fundos",
        fetchedAt,
        license: CVM_LICENSE,
        sourceRef: arquivo.sourceRef,
      });
      if (buffer.size >= LOTE) await gravar();
    }
    await gravar();
    await concluirCarga(db, carga, linhas);
    opcoes.log("info", "informe diario de fundos carregado", {
      mes: opcoes.aaaamm,
      linhas,
    });
    return { pulado: false, linhas, eventos: 0 };
  } catch (erro) {
    await falharCarga(db, carga, erro);
    throw erro;
  }
}

// ---------------------------------------------------------------------------
// CVM: informe mensal de FII
// ---------------------------------------------------------------------------

/**
 * Informe mensal de FII de um ano em `fii_monthly`.
 *
 * Emite `fii.report.published` com a competencia mais recente de cada fundo
 * que mudou (nova ou reapresentada) e tem ticker. As competencias antigas do
 * mesmo fundo nao viram evento: o recalculo do analytics le a serie inteira.
 */
export async function carregarInformeFii(
  db: Db,
  cvm: CvmAdapter,
  opcoes: { ano: number; log: Log },
): Promise<ResultadoDeCarga> {
  const arquivo = await cvm.informeMensalFii(opcoes.ano);
  if (!arquivo) return { pulado: true, linhas: 0, eventos: 0 };
  const carga = await abrirCarga(db, { source: "cvm-fii-mensal", ...arquivo });
  if (carga.jaCarregado) return { pulado: true, linhas: 0, eventos: 0 };

  try {
    const fetchedAt = agoraIso();
    const informes = await arquivo.informes();
    const mudaram = new Map<string, string>();
    const marcar = (cnpj: string, data: string) => {
      if ((mudaram.get(cnpj) ?? "") < data) mudaram.set(cnpj, data);
    };

    for (const lote of lotes(informes, 1000)) {
      const gravadas = await db
        .insert(fiiMonthly)
        .values(
          lote.map((i) => ({
            ...i,
            source: "cvm-fii-mensal",
            fetchedAt,
            license: CVM_LICENSE,
          })),
        )
        .onConflictDoUpdate({
          target: [fiiMonthly.cnpj, fiiMonthly.referenceDate],
          set: {
            version: sql`excluded.version`,
            isin: sql`excluded.isin`,
            name: sql`excluded.name`,
            segment: sql`excluded.segment`,
            totalAssets: sql`excluded.total_assets`,
            equity: sql`excluded.equity`,
            sharesOutstanding: sql`excluded.shares_outstanding`,
            navPerShare: sql`excluded.nav_per_share`,
            holders: sql`excluded.holders`,
            dividendYieldMonth: sql`excluded.dividend_yield_month`,
            effectiveReturnMonth: sql`excluded.effective_return_month`,
            amortizationMonth: sql`excluded.amortization_month`,
            dividendsPayable: sql`excluded.dividends_payable`,
            fetchedAt: sql`excluded.fetched_at`,
            sourceRef: sql`excluded.source_ref`,
          },
          // Versao menor nunca sobrescreve; a mesma versao so quando o numero mudou.
          setWhere: sql`excluded.version > ${fiiMonthly.version}
            OR (excluded.version = ${fiiMonthly.version}
                AND (excluded.equity, excluded.nav_per_share, excluded.holders, excluded.dividend_yield_month, excluded.isin)
                    IS DISTINCT FROM (${fiiMonthly.equity}, ${fiiMonthly.navPerShare}, ${fiiMonthly.holders}, ${fiiMonthly.dividendYieldMonth}, ${fiiMonthly.isin}))`,
        })
        .returning({ cnpj: fiiMonthly.cnpj, referenceDate: fiiMonthly.referenceDate });
      for (const g of gravadas) marcar(g.cnpj, g.referenceDate);
    }
    if (carga.recuperacao) for (const i of informes) marcar(i.cnpj, i.referenceDate);

    let eventos = 0;
    let ligados = 0;
    await db.transaction(async (tx) => {
      ligados = await ligarFiisAosTickers(tx);
      eventos = await emitirInformesFii(tx, mudaram);
      await concluirCarga(tx, carga, informes.length);
    });

    opcoes.log("info", "informe mensal de FII carregado", {
      arquivo: arquivo.sourceRef,
      linhas: informes.length,
      fundos: new Set(informes.map((i) => i.cnpj)).size,
      tickersLigados: ligados,
      eventos,
    });
    return { pulado: false, linhas: informes.length, eventos };
  } catch (erro) {
    await falharCarga(db, carga, erro);
    throw erro;
  }
}

/**
 * Liga o CNPJ do FII aos tickers pelo ISIN: o informe traz o ISIN da cota, e
 * o COTAHIST, o de cada papel. O FCA, que liga as companhias, nao cobre fundo.
 * Roda a cada carga (mesmo com o arquivo pulado), porque o COTAHIST pode ter
 * criado o ticker depois do informe.
 */
export async function ligarFiisAosTickers(tx: Pick<Db, "execute">): Promise<number> {
  const r = await tx.execute(sql`
    UPDATE market_data.assets a SET cnpj = f.cnpj, updated_at = now()
    FROM (
      SELECT DISTINCT ON (isin) isin, cnpj FROM market_data.fii_monthly
      WHERE isin IS NOT NULL ORDER BY isin, reference_date DESC
    ) f
    WHERE a.isin = f.isin AND a.kind = 'fii' AND a.cnpj IS DISTINCT FROM f.cnpj`);
  return r.rowCount ?? 0;
}

async function emitirInformesFii(tx: Tx, mudaram: Map<string, string>): Promise<number> {
  if (mudaram.size === 0) return 0;
  const tickersPorCnpj = new Map<string, string[]>();
  for (const lote of lotes([...mudaram.keys()], 1000)) {
    const linhas = await tx
      .select({ cnpj: assets.cnpj, ticker: assets.ticker })
      .from(assets)
      .where(and(inArray(assets.cnpj, lote), eq(assets.kind, "fii")));
    for (const l of linhas) {
      if (!l.cnpj || !l.ticker) continue;
      tickersPorCnpj.set(l.cnpj, [...(tickersPorCnpj.get(l.cnpj) ?? []), l.ticker]);
    }
  }
  // Fundo sem ticker na bolsa nao tem quem recalcular.
  const eventos = [...mudaram]
    .filter(([cnpj]) => tickersPorCnpj.has(cnpj))
    .map(([cnpj, referenceDate]) =>
      linhaDeOutbox({
        name: "marketdata.fii.report.published.v1",
        producer: PRODUTOR,
        payload: {
          cnpj,
          tickers: (tickersPorCnpj.get(cnpj) ?? []).sort(),
          reference_date: referenceDate,
        },
      }),
    );
  for (const lote of lotes(eventos, 1000)) await tx.insert(outbox).values(lote);
  return eventos.length;
}

/** Meses AAAAMM do mais antigo ao atual, `n` meses ao todo. */
export function ultimosMeses(hoje: string, n: number): string[] {
  const [a, m] = hoje.split("-").map(Number) as [number, number];
  const saida: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(a, m - 1 - i, 1));
    saida.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return saida;
}
