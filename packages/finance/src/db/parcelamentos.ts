import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { faturaDoMes, type CicloDoCartao } from "../cartao.js";
import type {
  Comprometido,
  DetalheDoPlano,
  NovoEmprestimo,
  NovoParcelamentoNoCartao,
  PedidoDeAmortizacao,
  Plano,
  ResultadoDaExclusao,
} from "../contratos-parcelamento.js";
import { d, moeda } from "../decimal.js";
import { competenciaDe } from "../dominio.js";
import {
  saldoDevedor,
  simularAmortizacao,
  tabela,
  type EventoDaDivida,
  type ModoDeAmortizacao,
  type Simulacao,
} from "../emprestimo.js";
import { normalizarDeExtrato } from "../importacao/normalizar.js";
import { dividirTotal, parcelasNoCartao, somarMeses } from "../parcelamento.js";
import {
  auditar,
  categoriaDoUsuario,
  ErroDeFinancas,
  exigirCartao,
  exigirConta,
  faturaDaData,
  obterFatura,
  type Origem,
  type Tx,
} from "./operacoes.js";
import { installment_plans, statements, transactions } from "./schema.js";

type LinhaDoPlano = typeof installment_plans.$inferSelect;
type Parcela = {
  id: string;
  parcela_numero: number | null;
  data: string;
  valor: string;
  status: string;
  statement_id: string | null;
};

const realizada = (s: string) => s !== "previsto";

async function linhaDoPlano(tx: Tx, uid: string, id: string): Promise<LinhaDoPlano> {
  const [p] = await tx
    .select()
    .from(installment_plans)
    .where(and(eq(installment_plans.user_id, uid), eq(installment_plans.id, id)));
  if (!p) throw new ErroDeFinancas(404, "Parcelamento não encontrado.");
  return p;
}

async function parcelasDoPlano(tx: Tx, uid: string, id: string): Promise<Parcela[]> {
  return tx
    .select({
      id: transactions.id,
      parcela_numero: transactions.parcela_numero,
      data: transactions.data,
      valor: transactions.valor,
      status: transactions.status,
      statement_id: transactions.statement_id,
    })
    .from(transactions)
    .where(and(eq(transactions.user_id, uid), eq(transactions.installment_plan_id, id)))
    .orderBy(asc(transactions.data), asc(transactions.parcela_numero));
}

const eventos = (parcelas: Parcela[]): EventoDaDivida[] =>
  parcelas
    .filter((p) => realizada(p.status))
    .map((p) => ({
      data: p.data,
      tipo: p.parcela_numero === null ? "extra" : "parcela",
      valor: p.valor,
    }));

function resumo(p: LinhaDoPlano, parcelas: Parcela[]): Plano {
  const numeradas = parcelas.filter((x) => x.parcela_numero !== null);
  const previstas = numeradas.filter((x) => !realizada(x.status));
  const restante = previstas.reduce((s, x) => s.plus(x.valor), d(0));
  const proxima = previstas[0];
  // Plano criado de uma parcela importada (6/7) nao tem as anteriores: ja pagas.
  const anteriores = numeradas.length
    ? Math.min(...numeradas.map((x) => x.parcela_numero as number)) - 1
    : 0;
  return {
    id: p.id,
    origem: p.origem as Plano["origem"],
    descricao: p.descricao,
    category_id: p.category_id,
    card_id: p.card_id,
    account_id: p.account_id,
    valor_total: p.valor_total,
    valor_financiado: p.valor_financiado,
    n_parcelas: p.n_parcelas,
    sistema: p.sistema as Plano["sistema"],
    taxa_mensal: p.taxa_mensal,
    primeira_data: p.primeira_data,
    ativo: p.ativo,
    parcelas_pagas: anteriores + numeradas.length - previstas.length,
    parcelas_restantes: previstas.length,
    valor_restante: moeda(restante),
    saldo_devedor:
      p.origem === "cartao"
        ? moeda(restante)
        : previstas.length === 0
          ? "0.00"
          : saldoDevedor(p.valor_financiado, p.taxa_mensal, eventos(parcelas)),
    proxima: proxima
      ? {
          numero: proxima.parcela_numero as number,
          data: proxima.data,
          valor: proxima.valor,
        }
      : null,
  };
}

export async function listarPlanos(tx: Tx, uid: string): Promise<Plano[]> {
  const planos = await tx
    .select()
    .from(installment_plans)
    .where(eq(installment_plans.user_id, uid))
    .orderBy(desc(installment_plans.ativo), asc(installment_plans.criado_em));
  return Promise.all(
    planos.map(async (p) => resumo(p, await parcelasDoPlano(tx, uid, p.id))),
  );
}

export async function detalheDoPlano(
  tx: Tx,
  uid: string,
  id: string,
): Promise<DetalheDoPlano> {
  const p = await linhaDoPlano(tx, uid, id);
  const parcelas = await parcelasDoPlano(tx, uid, id);
  const r = resumo(p, parcelas);
  // Juros e amortizacao de cada parcela pelo saldo de cada momento (o
  // historico inclui as amortizacoes extras).
  const i = d(p.taxa_mensal);
  let saldo = d(p.valor_financiado);
  const linhas: DetalheDoPlano["tabela"] = [];
  for (const x of parcelas) {
    if (x.parcela_numero === null) {
      saldo = saldo.minus(x.valor);
      continue;
    }
    const juros = p.origem === "cartao" ? d(0) : saldo.times(i).toDecimalPlaces(2);
    const amort = d(x.valor).minus(juros);
    saldo = saldo.minus(amort);
    linhas.push({
      numero: x.parcela_numero,
      data: x.data,
      parcela: moeda(d(x.valor)),
      juros: moeda(juros),
      amortizacao: moeda(amort),
      saldo: moeda(saldo.lt(0) ? d(0) : saldo),
      status: x.status as DetalheDoPlano["tabela"][number]["status"],
    });
  }
  return { ...r, tabela: linhas };
}

async function validarCategoria(tx: Tx, uid: string, id: string | null | undefined) {
  if (!id) return;
  const c = await categoriaDoUsuario(tx, uid, id);
  if (c.natureza !== "despesa")
    throw new ErroDeFinancas(422, "Escolha uma categoria de despesa.");
}

/** Gera as parcelas do cartao a partir da fatura da compra (ou de `desde`). */
async function gerarParcelasNoCartao(
  tx: Tx,
  uid: string,
  plano: LinhaDoPlano,
  ciclo: CicloDoCartao,
  valores: string[],
  hoje: string,
  extra: {
    desde?: number;
    base?: { vencimento: string; numero: number };
    importacao_id?: string;
  } = {},
) {
  let parcelas = parcelasNoCartao(ciclo, plano.primeira_data, valores, extra.desde ?? 1);
  if (extra.base) {
    // A partir de uma fatura conhecida (a da importacao): parcela k cai k - base ciclos depois.
    const ano = Number(extra.base.vencimento.slice(0, 4));
    const mes = Number(extra.base.vencimento.slice(5, 7));
    parcelas = parcelas.map((x) => {
      const fatura = faturaDoMes(ciclo, ano, mes + x.numero - extra.base!.numero);
      return { ...x, fatura, data: fatura.fechamento };
    });
  }
  const linhas = [];
  for (const x of parcelas) {
    linhas.push({
      id: randomUUID(),
      user_id: uid,
      card_id: plano.card_id,
      statement_id: await obterFatura(
        tx,
        uid,
        plano.card_id as string,
        x.fatura.vencimento,
      ),
      tipo: "despesa",
      valor: x.valor,
      data: x.data,
      competencia: competenciaDe(x.data),
      descricao: `${plano.descricao} ${x.numero}/${plano.n_parcelas}`,
      descricao_normalizada: plano.descricao_normalizada,
      category_id: plano.category_id,
      status: x.data <= hoje ? "realizado" : "previsto",
      installment_plan_id: plano.id,
      parcela_numero: x.numero,
      importacao_id: extra.importacao_id ?? null,
    });
  }
  if (linhas.length) await tx.insert(transactions).values(linhas).onConflictDoNothing();
}

/** "10x de R$ 120": o plano e as parcelas, uma em cada fatura pelo ciclo. */
export async function criarParcelamentoNoCartao(
  tx: Tx,
  uid: string,
  p: NovoParcelamentoNoCartao,
  hoje: string,
  origem?: Origem,
): Promise<Plano> {
  const ciclo = await exigirCartao(tx, uid, p.card_id);
  await validarCategoria(tx, uid, p.category_id);
  const valores = p.valor_parcela
    ? Array<string>(p.n_parcelas).fill(moeda(d(p.valor_parcela)))
    : dividirTotal(p.valor_total as string, p.n_parcelas);
  const total = moeda(valores.reduce((s, v) => s.plus(v), d(0)));
  const [plano] = await tx
    .insert(installment_plans)
    .values({
      id: randomUUID(),
      user_id: uid,
      origem: "cartao",
      descricao: p.descricao,
      descricao_normalizada: normalizarDeExtrato(p.descricao),
      category_id: p.category_id ?? null,
      card_id: p.card_id,
      valor_total: total,
      valor_financiado: total,
      n_parcelas: p.n_parcelas,
      sistema: "sem_juros",
      primeira_data: p.data,
    })
    .returning();
  await gerarParcelasNoCartao(tx, uid, plano!, ciclo, valores, hoje);
  await auditar(
    tx,
    uid,
    "parcelamento.criado",
    "installment_plan",
    plano!.id,
    origem,
    total,
  );
  return resumo(plano!, await parcelasDoPlano(tx, uid, plano!.id));
}

/** Gera as parcelas de emprestimo a partir do numero `de`, um mes depois do outro. */
async function gerarParcelasDaDivida(
  tx: Tx,
  uid: string,
  plano: LinhaDoPlano,
  t: { parcela: string }[],
  de: number,
  primeiraData: string,
  hoje: string,
) {
  if (!t.length) return;
  await tx.insert(transactions).values(
    t.map((l, k) => {
      const data = somarMeses(primeiraData, k);
      return {
        id: randomUUID(),
        user_id: uid,
        account_id: plano.account_id,
        tipo: "despesa",
        valor: l.parcela,
        data,
        competencia: competenciaDe(data),
        descricao: `${plano.descricao} ${de + k}`,
        descricao_normalizada: plano.descricao_normalizada,
        category_id: plano.category_id,
        status: data <= hoje ? "realizado" : "previsto",
        installment_plan_id: plano.id,
        parcela_numero: de + k,
      };
    }),
  );
}

export async function criarEmprestimo(
  tx: Tx,
  uid: string,
  e: NovoEmprestimo,
  hoje: string,
  origem?: Origem,
): Promise<Plano> {
  await exigirConta(tx, uid, e.account_id);
  await validarCategoria(tx, uid, e.category_id);
  const t = tabela(e.sistema, e.valor_financiado, e.taxa_mensal, e.n_parcelas);
  const [plano] = await tx
    .insert(installment_plans)
    .values({
      id: randomUUID(),
      user_id: uid,
      origem: e.origem,
      descricao: e.descricao,
      descricao_normalizada: normalizarDeExtrato(e.descricao),
      category_id: e.category_id ?? null,
      account_id: e.account_id,
      valor_total: moeda(t.reduce((s, l) => s.plus(l.parcela), d(0))),
      valor_financiado: moeda(d(e.valor_financiado)),
      n_parcelas: e.n_parcelas,
      sistema: e.sistema,
      taxa_mensal: e.taxa_mensal,
      primeira_data: e.primeira_data,
    })
    .returning();
  await gerarParcelasDaDivida(tx, uid, plano!, t, 1, e.primeira_data, hoje);
  await auditar(
    tx,
    uid,
    "divida.criada",
    "installment_plan",
    plano!.id,
    origem,
    e.valor_financiado,
  );
  return resumo(plano!, await parcelasDoPlano(tx, uid, plano!.id));
}

function exigirDivida(
  p: LinhaDoPlano,
): asserts p is LinhaDoPlano & { sistema: "price" | "sac" } {
  if (p.origem === "cartao")
    throw new ErroDeFinancas(422, "Amortização extra é para empréstimo e financiamento.");
}

export async function simular(
  tx: Tx,
  uid: string,
  id: string,
  extra: string,
  modo: ModoDeAmortizacao,
): Promise<Simulacao> {
  const p = await linhaDoPlano(tx, uid, id);
  exigirDivida(p);
  const parcelas = await parcelasDoPlano(tx, uid, id);
  const restantes = parcelas.filter(
    (x) => x.parcela_numero !== null && !realizada(x.status),
  );
  if (!restantes.length) throw new ErroDeFinancas(409, "Esta dívida já está quitada.");
  return simularAmortizacao({
    sistema: p.sistema === "sac" ? "sac" : "price",
    saldo_devedor: saldoDevedor(p.valor_financiado, p.taxa_mensal, eventos(parcelas)),
    taxa: p.taxa_mensal,
    parcelas_restantes: restantes.length,
    extra,
    modo,
  });
}

/**
 * Amortizacao extra: grava o pagamento extra (lancamento realizado do plano,
 * sem numero de parcela) e refaz as previstas restantes pela simulacao.
 */
export async function amortizar(
  tx: Tx,
  uid: string,
  id: string,
  a: PedidoDeAmortizacao,
  hoje: string,
  origem?: Origem,
): Promise<DetalheDoPlano> {
  const p = await linhaDoPlano(tx, uid, id);
  exigirDivida(p);
  const sim = await simular(tx, uid, id, a.extra, a.modo);
  const parcelas = await parcelasDoPlano(tx, uid, id);
  const previstas = parcelas.filter(
    (x) => x.parcela_numero !== null && !realizada(x.status),
  );
  const saldo = saldoDevedor(p.valor_financiado, p.taxa_mensal, eventos(parcelas));
  const pago = d(a.extra).gt(saldo) ? saldo : moeda(d(a.extra));
  await tx.insert(transactions).values({
    id: randomUUID(),
    user_id: uid,
    account_id: p.account_id,
    tipo: "despesa",
    valor: pago,
    data: a.data,
    competencia: competenciaDe(a.data),
    descricao: `Amortização extra ${p.descricao}`,
    descricao_normalizada: p.descricao_normalizada,
    category_id: p.category_id,
    status: "realizado",
    installment_plan_id: id,
  });
  await tx.delete(transactions).where(
    and(
      eq(transactions.user_id, uid),
      inArray(
        transactions.id,
        previstas.map((x) => x.id),
      ),
    ),
  );
  const primeira = previstas[0]!;
  await gerarParcelasDaDivida(
    tx,
    uid,
    p,
    sim.tabela,
    primeira.parcela_numero as number,
    primeira.data,
    hoje,
  );
  if (!sim.tabela.length)
    await tx
      .update(installment_plans)
      .set({ ativo: false })
      .where(and(eq(installment_plans.user_id, uid), eq(installment_plans.id, id)));
  await auditar(
    tx,
    uid,
    "divida.amortizada",
    "installment_plan",
    id,
    origem,
    `${pago} ${a.modo}`,
  );
  return detalheDoPlano(tx, uid, id);
}

/**
 * Quitar: na divida, amortizacao extra do saldo inteiro; no cartao, as
 * parcelas restantes vao para a fatura atual (antecipacao).
 */
export async function quitar(
  tx: Tx,
  uid: string,
  id: string,
  data: string,
  hoje: string,
  origem?: Origem,
): Promise<DetalheDoPlano> {
  const p = await linhaDoPlano(tx, uid, id);
  if (p.origem !== "cartao") {
    const parcelas = await parcelasDoPlano(tx, uid, id);
    const saldo = saldoDevedor(p.valor_financiado, p.taxa_mensal, eventos(parcelas));
    return amortizar(
      tx,
      uid,
      id,
      { extra: saldo, modo: "reduzir_prazo", data },
      hoje,
      origem,
    );
  }
  const previstas = (await parcelasDoPlano(tx, uid, id)).filter(
    (x) => x.parcela_numero !== null && !realizada(x.status),
  );
  const fatura = await faturaDaData(tx, uid, p.card_id as string, data);
  if (previstas.length)
    await tx
      .update(transactions)
      .set({
        statement_id: fatura,
        data,
        competencia: competenciaDe(data),
        status: "realizado",
        atualizada_em: sql`now()`,
      })
      .where(
        and(
          eq(transactions.user_id, uid),
          inArray(
            transactions.id,
            previstas.map((x) => x.id),
          ),
        ),
      );
  await tx
    .update(installment_plans)
    .set({ ativo: false })
    .where(and(eq(installment_plans.user_id, uid), eq(installment_plans.id, id)));
  await auditar(tx, uid, "parcelamento.quitado", "installment_plan", id, origem);
  return detalheDoPlano(tx, uid, id);
}

/**
 * Apaga o plano e as parcelas previstas; os lancamentos realizados (parcelas
 * pagas e amortizacoes extras) ficam no historico, soltos do plano (ADR 0039).
 */
async function excluirPlano(
  tx: Tx,
  uid: string,
  p: LinhaDoPlano,
  acao: string,
  origem?: Origem,
): Promise<ResultadoDaExclusao> {
  const apagadas = await tx
    .delete(transactions)
    .where(
      and(
        eq(transactions.user_id, uid),
        eq(transactions.installment_plan_id, p.id),
        eq(transactions.status, "previsto"),
      ),
    )
    .returning({ id: transactions.id });
  const soltos = await tx
    .update(transactions)
    .set({ installment_plan_id: null, parcela_numero: null, atualizada_em: sql`now()` })
    .where(and(eq(transactions.user_id, uid), eq(transactions.installment_plan_id, p.id)))
    .returning({ id: transactions.id });
  await tx
    .delete(installment_plans)
    .where(and(eq(installment_plans.user_id, uid), eq(installment_plans.id, p.id)));
  const r = {
    previstas_apagadas: apagadas.length,
    realizados_desvinculados: soltos.length,
  };
  await auditar(
    tx,
    uid,
    acao,
    "installment_plan",
    p.id,
    origem,
    `${p.descricao}: ${r.previstas_apagadas} previstas apagadas, ${r.realizados_desvinculados} realizados mantidos`,
  );
  return r;
}

/** Qualquer plano (compra parcelada no cartao ou divida). */
export async function apagarPlano(
  tx: Tx,
  uid: string,
  id: string,
  origem?: Origem,
): Promise<ResultadoDaExclusao> {
  const p = await linhaDoPlano(tx, uid, id);
  return excluirPlano(tx, uid, p, "parcelamento.apagado", origem);
}

/** So emprestimo ou financiamento; compra parcelada no cartao recusa com 422. */
export async function apagarDivida(
  tx: Tx,
  uid: string,
  id: string,
  origem?: Origem,
): Promise<ResultadoDaExclusao> {
  const p = await linhaDoPlano(tx, uid, id);
  if (p.origem === "cartao")
    throw new ErroDeFinancas(
      422,
      "Compra parcelada no cartão se exclui em Parcelamentos.",
    );
  return excluirPlano(tx, uid, p, "divida.apagada", origem);
}

/**
 * Quanto as parcelas tiram do caixa em cada um dos proximos meses: cartao no
 * mes do vencimento da fatura, divida no mes da parcela.
 */
export async function comprometidoPorMes(
  tx: Tx,
  uid: string,
  hoje: string,
  meses = 12,
): Promise<Comprometido> {
  const inicio = `${hoje.slice(0, 7)}-01`;
  const lista = Array.from({ length: meses }, (_, k) =>
    somarMeses(inicio, k).slice(0, 7),
  );
  const linhas = await tx
    .select({
      plano_id: transactions.installment_plan_id,
      descricao: installment_plans.descricao,
      mes: sql<string>`to_char(coalesce(${statements.vencimento}, ${transactions.data}), 'YYYY-MM')`,
      valor: sql<string>`sum(${transactions.valor})::numeric(18,2)::text`,
    })
    .from(transactions)
    .innerJoin(
      installment_plans,
      and(
        eq(installment_plans.id, transactions.installment_plan_id),
        eq(installment_plans.user_id, uid),
      ),
    )
    .leftJoin(statements, eq(statements.id, transactions.statement_id))
    .where(
      and(
        eq(transactions.user_id, uid),
        isNotNull(transactions.parcela_numero),
        gte(sql`coalesce(${statements.vencimento}, ${transactions.data})`, inicio),
      ),
    )
    .groupBy(transactions.installment_plan_id, installment_plans.descricao, sql`3`);
  return lista.map((mes) => {
    const doMes = linhas.filter((l) => l.mes === mes);
    return {
      mes,
      total: moeda(doMes.reduce((s, l) => s.plus(l.valor), d(0))),
      por_plano: doMes.map((l) => ({
        plano_id: l.plano_id as string,
        descricao: l.descricao,
        valor: moeda(d(l.valor)),
      })),
    };
  });
}

// Importacao: parcela detectada

export interface ParcelaPrevistaDoPlano {
  transaction_id: string;
  plano_id: string;
}

/**
 * A parcela prevista de um plano compativel com a linha importada: mesmo
 * cartao, descricao normalizada igual, valor a 1 centavo e o numero esperado,
 * ainda sem FITID.
 */
export async function acharParcelaDoPlano(
  tx: Tx,
  uid: string,
  cardId: string,
  linha: { descricao_normalizada: string; valor: string; parcela_atual: number },
): Promise<ParcelaPrevistaDoPlano | null> {
  const [x] = await tx
    .select({ transaction_id: transactions.id, plano_id: installment_plans.id })
    .from(transactions)
    .innerJoin(
      installment_plans,
      and(
        eq(installment_plans.id, transactions.installment_plan_id),
        eq(installment_plans.user_id, uid),
      ),
    )
    .where(
      and(
        eq(transactions.user_id, uid),
        eq(installment_plans.card_id, cardId),
        eq(installment_plans.descricao_normalizada, linha.descricao_normalizada),
        eq(transactions.parcela_numero, linha.parcela_atual),
        sql`${transactions.fitid} is null and ${transactions.hash_dedupe} is null`,
        sql`abs(${transactions.valor} - ${linha.valor}::numeric) <= 0.01`,
      ),
    )
    .limit(1);
  return x ?? null;
}

/**
 * Parcela importada sem plano: cria o plano a partir dela (liga o lancamento
 * gravado) e gera so as restantes, nas faturas seguintes a da importacao.
 */
export async function criarPlanoDaParcelaImportada(
  tx: Tx,
  uid: string,
  p: {
    card_id: string;
    statement_vencimento: string;
    transaction_id: string;
    descricao: string;
    descricao_normalizada: string;
    category_id: string | null;
    data: string;
    valor: string;
    parcela_atual: number;
    parcela_total: number;
    importacao_id: string;
  },
  hoje: string,
): Promise<string> {
  const ciclo = await exigirCartao(tx, uid, p.card_id);
  const total = moeda(d(p.valor).times(p.parcela_total));
  const [plano] = await tx
    .insert(installment_plans)
    .values({
      id: randomUUID(),
      user_id: uid,
      origem: "cartao",
      descricao: p.descricao,
      descricao_normalizada: p.descricao_normalizada,
      category_id: p.category_id,
      card_id: p.card_id,
      valor_total: total,
      valor_financiado: total,
      n_parcelas: p.parcela_total,
      sistema: "sem_juros",
      primeira_data: somarMeses(p.data, -(p.parcela_atual - 1)),
    })
    .returning();
  await tx
    .update(transactions)
    .set({ installment_plan_id: plano!.id, parcela_numero: p.parcela_atual })
    .where(and(eq(transactions.user_id, uid), eq(transactions.id, p.transaction_id)));
  await gerarParcelasNoCartao(
    tx,
    uid,
    plano!,
    ciclo,
    Array<string>(p.parcela_total).fill(moeda(d(p.valor))),
    hoje,
    {
      desde: p.parcela_atual + 1,
      base: { vencimento: p.statement_vencimento, numero: p.parcela_atual },
      importacao_id: p.importacao_id,
    },
  );
  return plano!.id;
}

/** Depois de desfazer importacao: plano sem nenhum lancamento some. */
export async function apagarPlanosVazios(tx: Tx, uid: string) {
  await tx.execute(sql`
    delete from finance.installment_plans p
     where p.user_id = ${uid}
       and not exists (select 1 from finance.transactions t
                        where t.installment_plan_id = p.id and t.user_id = ${uid})`);
}
