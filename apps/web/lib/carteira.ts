import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { headers } from "next/headers";
import type { AssetDetail, LiveQuote } from "@bolsiq/contracts";
import {
  alocar,
  apurar,
  avaliar,
  comoUsuario,
  eventosAplicados,
  importarCsvBolsiq,
  importarExtratoB3,
  proventosPorMes,
  schema,
  Transacao,
  type FatiaDeAlocacao,
  type LinhaRejeitada,
  type PosicaoAvaliada,
  type TransacaoDoUsuario,
} from "@bolsiq/portfolio";
import { nivelDeTaxa } from "@bolsiq/analytics/puro";
import { banco } from "./analytics";
import {
  CLASSE,
  alinhar,
  ipcaMais6,
  retornoDaSerie,
  ultimos12Meses,
  umAnoAntes,
  type NovaTransacao,
} from "./carteira-modelo";
import { hojeEmSp } from "./indicadores-tecnicos";
import { buscarV1, VALIDADE } from "./market-data";

const { portfolios, transactions, snapshots, imports, audit_log } = schema;

/**
 * Carteira e modulo do app (CLAUDE.md). Toda leitura e escrita passa por
 * `comoUsuario`: filtro por usuario aqui e RLS no banco (ADR 0011).
 */

export class ErroDeCarteira extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export interface CarteiraResumida {
  id: string;
  nome: string;
}

async function auditar(
  tx: TransacaoDoUsuario<Record<string, unknown>>,
  uid: string,
  acao: string,
  recurso_id: string,
  detalhe?: string,
): Promise<void> {
  const h = await headers();
  await tx.insert(audit_log).values({
    id: randomUUID(),
    user_id: uid,
    acao,
    recurso: "portfolio",
    recurso_id,
    detalhe: detalhe ?? null,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    user_agent: h.get("user-agent")?.slice(0, 300) ?? null,
  });
}

/** Marca para o portfolio-worker recalcular os snapshots desde a data. */
function marcar(
  tx: TransacaoDoUsuario<Record<string, unknown>>,
  id: string,
  desde: string,
) {
  return tx
    .update(portfolios)
    .set({
      recalcular_desde: sql`least(coalesce(${portfolios.recalcular_desde}, ${desde}::date), ${desde}::date)`,
    })
    .where(eq(portfolios.id, id));
}

export async function listarCarteiras(uid: string): Promise<CarteiraResumida[]> {
  return comoUsuario(banco(), uid, (tx) =>
    tx
      .select({ id: portfolios.id, nome: portfolios.nome })
      .from(portfolios)
      .where(and(eq(portfolios.user_id, uid), eq(portfolios.arquivada, false)))
      .orderBy(asc(portfolios.criada_em)),
  );
}

export async function criarCarteira(
  uid: string,
  nome: string,
): Promise<CarteiraResumida> {
  const id = randomUUID();
  try {
    await comoUsuario(banco(), uid, async (tx) => {
      await tx.insert(portfolios).values({ id, user_id: uid, nome });
      await auditar(tx, uid, "carteira.criada", id, nome);
    });
  } catch (erro) {
    if (
      (erro as { cause?: { code?: string } }).cause?.code === "23505" ||
      (erro as { code?: string }).code === "23505"
    )
      throw new ErroDeCarteira(409, "Já existe uma carteira com esse nome.");
    throw erro;
  }
  return { id, nome };
}

/** Primeira visita: cria "Principal" para a tela nunca abrir vazia de carteira. */
export async function carteirasOuPadrao(uid: string): Promise<CarteiraResumida[]> {
  const lista = await listarCarteiras(uid);
  return lista.length ? lista : [await criarCarteira(uid, "Principal")];
}

/** Garante que a carteira e do usuario. Id de outro usuario e 404, como inexistente. */
async function garantirDona(
  tx: TransacaoDoUsuario<Record<string, unknown>>,
  uid: string,
  id: string,
) {
  const [c] = await tx
    .select({
      id: portfolios.id,
      nome: portfolios.nome,
      recalcular_desde: portfolios.recalcular_desde,
    })
    .from(portfolios)
    .where(and(eq(portfolios.id, id), eq(portfolios.user_id, uid)));
  if (!c) throw new ErroDeCarteira(404, "Carteira não encontrada.");
  return c;
}

export async function adicionarTransacao(
  uid: string,
  carteira: string,
  t: NovaTransacao,
) {
  const id = randomUUID();
  await comoUsuario(banco(), uid, async (tx) => {
    await garantirDona(tx, uid, carteira);
    await tx.insert(transactions).values({
      id,
      portfolio_id: carteira,
      user_id: uid,
      ticker: t.ticker,
      tipo: t.tipo,
      data: t.data,
      quantidade: t.quantidade,
      preco: t.preco,
      taxas: t.taxas,
      corretora: t.corretora ?? null,
    });
    await marcar(tx, carteira, t.data);
    await auditar(
      tx,
      uid,
      "transacao.criada",
      carteira,
      `${t.tipo} ${t.ticker} ${t.data}`,
    );
  });
  return { id };
}

export interface RelatorioNaTela {
  linhas_lidas: number;
  linhas_aceitas: number;
  linhas_rejeitadas: number;
  rejeicoes: LinhaRejeitada[];
  duracao_ms: number;
}

/** Importa CSV do Bolsiq ou extrato da B3; linha ruim vira relatorio, nao aborta. */
export async function importar(
  uid: string,
  carteira: string,
  formato: "bolsiq" | "b3",
  nomeArquivo: string,
  conteudo: string,
): Promise<RelatorioNaTela> {
  const inicio = performance.now();
  const r = formato === "b3" ? importarExtratoB3(conteudo) : importarCsvBolsiq(conteudo);
  const importacao = randomUUID();
  await comoUsuario(banco(), uid, async (tx) => {
    await garantirDona(tx, uid, carteira);
    for (let i = 0; i < r.transacoes.length; i += 1000) {
      await tx.insert(transactions).values(
        r.transacoes.slice(i, i + 1000).map((t) => ({
          id: randomUUID(),
          portfolio_id: carteira,
          user_id: uid,
          ticker: t.ticker,
          tipo: t.tipo,
          data: t.data,
          quantidade: t.quantidade,
          preco: t.preco,
          taxas: t.taxas,
          corretora: t.corretora ?? null,
          importacao_id: importacao,
        })),
      );
    }
    const duracao = Math.round(performance.now() - inicio);
    await tx.insert(imports).values({
      id: importacao,
      portfolio_id: carteira,
      user_id: uid,
      formato,
      nome_arquivo: nomeArquivo.slice(0, 200),
      linhas_lidas: r.linhas_lidas,
      linhas_aceitas: r.transacoes.length,
      linhas_rejeitadas: r.rejeicoes.length,
      rejeicoes: JSON.stringify(r.rejeicoes),
      duracao_ms: duracao,
    });
    const primeira = r.transacoes.map((t) => t.data).sort()[0];
    if (primeira) await marcar(tx, carteira, primeira);
    await auditar(
      tx,
      uid,
      "importacao",
      carteira,
      `${formato}: ${r.transacoes.length} de ${r.linhas_lidas}`,
    );
  });
  return {
    linhas_lidas: r.linhas_lidas,
    linhas_aceitas: r.transacoes.length,
    linhas_rejeitadas: r.rejeicoes.length,
    rejeicoes: r.rejeicoes,
    duracao_ms: Math.round(performance.now() - inicio),
  };
}

async function ou<T>(caminho: string, validade: number): Promise<T | null> {
  try {
    const r = await buscarV1<T>(caminho, validade);
    return r.status === 200 ? r.corpo : null;
  } catch {
    return null;
  }
}

async function cotacoes(tickers: string[]): Promise<Map<string, LiveQuote>> {
  const lotes: string[][] = [];
  for (let i = 0; i < tickers.length; i += 20) lotes.push(tickers.slice(i, i + 20));
  const respostas = await Promise.all(
    lotes.map((l) => ou<{ data: LiveQuote[] }>(`quotes/${l.join(",")}`, VALIDADE.quotes)),
  );
  return new Map(respostas.flatMap((r) => r?.data ?? []).map((q) => [q.ticker, q]));
}

async function cadastros(tickers: string[]): Promise<Map<string, AssetDetail>> {
  const r = await Promise.all(
    tickers.map((t) => ou<{ data: AssetDetail }>(`assets/${t}`, VALIDADE.assets)),
  );
  return new Map(r.flatMap((x) => (x ? [[x.data.ticker, x.data] as const] : [])));
}

export interface PosicaoNaTela extends PosicaoAvaliada {
  evento: string | null;
  classe: string;
  setor: string;
}

export interface PainelDaCarteira {
  carteira: CarteiraResumida;
  carteiras: CarteiraResumida[];
  resumo: {
    patrimonio: string | null;
    custo: string;
    nao_realizado: string | null;
    nao_realizado_pct: number | null;
    realizado: string;
    proventos_12m: string;
    twr_12m: number | null;
    cdi_12m: number | null;
  };
  posicoes: PosicaoNaTela[];
  alocacao: Record<"classe" | "setor" | "ativo", FatiaDeAlocacao[]>;
  proventos_mes: { mes: string; valor: number }[];
  serie: {
    data: string;
    carteira: number;
    cdi: number | null;
    ipca6: number | null;
    ibov: number | null;
  }[];
  recalculando: boolean;
  transacoes: number;
}

/** Tudo o que /carteiras/[id] mostra, numa ida ao banco e ao /v1. */
export async function painel(uid: string, id: string): Promise<PainelDaCarteira> {
  const hoje = hojeEmSp();
  const inicio12m = umAnoAntes(hoje);
  const { carteira, linhas, pontos, lista } = await comoUsuario(
    banco(),
    uid,
    async (tx) => {
      const carteira = await garantirDona(tx, uid, id);
      const linhas = await tx
        .select()
        .from(transactions)
        .where(eq(transactions.portfolio_id, id))
        .orderBy(asc(transactions.data));
      const pontos = await tx
        .select({ data: snapshots.data, base_100: snapshots.base_100 })
        .from(snapshots)
        .where(and(eq(snapshots.portfolio_id, id), gte(snapshots.data, inicio12m)))
        .orderBy(asc(snapshots.data));
      const lista = await tx
        .select({ id: portfolios.id, nome: portfolios.nome })
        .from(portfolios)
        .where(and(eq(portfolios.user_id, uid), eq(portfolios.arquivada, false)))
        .orderBy(asc(portfolios.criada_em));
      return { carteira, linhas, pontos, lista };
    },
  );

  const txs = linhas.map((l) =>
    Transacao.parse({
      id: l.id,
      ticker: l.ticker,
      tipo: l.tipo,
      data: l.data,
      quantidade: l.quantidade,
      preco: l.preco,
      taxas: l.taxas,
    }),
  );
  const apuracao = apurar(txs);
  const abertas = apuracao.posicoes.filter((p) => Number(p.quantidade) > 0);
  const tickers = abertas.map((p) => p.ticker);
  const [precos, ativos] = await Promise.all([cotacoes(tickers), cadastros(tickers)]);
  const avaliadas = avaliar(
    abertas,
    Object.fromEntries([...precos].map(([t, q]) => [t, q.price])),
  );
  const eventos = eventosAplicados(txs);
  const posicoes: PosicaoNaTela[] = avaliadas
    .map((p) => {
      const a = ativos.get(p.ticker);
      return {
        ...p,
        evento: eventos.get(p.ticker) ?? null,
        classe: (a && CLASSE[a.kind]) ?? "Outros",
        setor: a?.sector ?? "Sem setor",
      };
    })
    .sort(
      (a, b) =>
        Number(b.valor_de_mercado ?? b.custo_total) -
        Number(a.valor_de_mercado ?? a.custo_total),
    );

  const comPreco = posicoes.filter((p) => p.valor_de_mercado !== null);
  const patrimonio = comPreco.length
    ? comPreco.reduce((s, p) => s + Number(p.valor_de_mercado), 0)
    : null;
  const custoComPreco = comPreco.reduce((s, p) => s + Number(p.custo_total), 0);
  const custo = posicoes.reduce((s, p) => s + Number(p.custo_total), 0);
  const proventos12m = proventosPorMes(txs)
    .filter((p) => p.mes >= inicio12m.slice(0, 7))
    .reduce((s, p) => s + Number(p.valor), 0);

  // Benchmarks nas mesmas datas da carteira.
  const datas = pontos.map((p) => p.data);
  const de = datas[0] ?? inicio12m;
  const [cdi, ipca, ibov] = await Promise.all(
    (["cdi", "ipca", "ibov"] as const).map((s) =>
      ou<{ data: { points: { date: string; value: string }[] } }>(
        `macro/${s}?from=${de}`,
        VALIDADE.macro,
      ),
    ),
  );
  const nivelCdi = alinhar(
    datas,
    nivelDeTaxa(cdi?.data.points ?? []).map((p) => ({ date: p.date, valor: p.valor })),
  );
  const nivelIpca = alinhar(datas, ipcaMais6(ipca?.data.points ?? []));
  const nivelIbov = alinhar(
    datas,
    (ibov?.data.points ?? []).map((p) => ({ date: p.date, valor: Number(p.value) })),
  );
  const base = Number(pontos[0]?.base_100 ?? 100);
  const serie = pontos.map((p, i) => ({
    data: p.data,
    carteira: (Number(p.base_100) / base) * 100,
    cdi: nivelCdi[i] ?? null,
    ipca6: nivelIpca[i] ?? null,
    ibov: nivelIbov[i] ?? null,
  }));

  const moeda = (n: number) => n.toFixed(2);
  return {
    carteira: { id: carteira.id, nome: carteira.nome },
    carteiras: lista,
    resumo: {
      patrimonio: patrimonio === null ? null : moeda(patrimonio),
      custo: moeda(custo),
      nao_realizado: patrimonio === null ? null : moeda(patrimonio - custoComPreco),
      nao_realizado_pct:
        patrimonio === null || custoComPreco === 0
          ? null
          : patrimonio / custoComPreco - 1,
      realizado: apuracao.resultado_realizado_total,
      proventos_12m: moeda(proventos12m),
      twr_12m: retornoDaSerie(serie.map((s) => s.carteira)),
      cdi_12m: retornoDaSerie(nivelCdi),
    },
    posicoes,
    alocacao: {
      classe: alocar(posicoes, (p) => (p as PosicaoNaTela).classe),
      setor: alocar(posicoes, (p) => (p as PosicaoNaTela).setor),
      ativo: alocar(posicoes, (p) => p.ticker),
    },
    proventos_mes: ultimos12Meses(proventosPorMes(txs), hoje),
    serie,
    recalculando: carteira.recalcular_desde !== null,
    transacoes: txs.length,
  };
}

export async function ultimasImportacoes(uid: string, carteira: string) {
  return comoUsuario(banco(), uid, (tx) =>
    tx
      .select()
      .from(imports)
      .where(eq(imports.portfolio_id, carteira))
      .orderBy(desc(imports.criada_em))
      .limit(5),
  );
}
