import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  faturaDaCompra,
  faturaDoMes,
  faturasAoRedor,
  fechou,
  type Fatura,
} from "../cartao.js";
import type { DetalheDaFatura, PagamentoDeFatura } from "../contratos-planejamento.js";
import type { Lancamento } from "../contratos.js";
import { d, moeda } from "../decimal.js";
import { montarTransferencia } from "../dominio.js";
import type {
  Cartao,
  EdicaoDeCartao,
  NovoCartao,
  ResumoDeFatura,
} from "../contratos-importacao.js";
import {
  auditar,
  ErroDeFinancas,
  exigirConta,
  unico,
  type Origem,
  type Tx,
} from "./operacoes.js";
import { cards, categories, imports, statements, transactions } from "./schema.js";

const colunasDeCartao = {
  id: cards.id,
  nome: cards.nome,
  instituicao: cards.instituicao,
  final: cards.final,
  bandeira: cards.bandeira,
  cor: cards.cor,
  limite: cards.limite,
  dia_fechamento: cards.dia_fechamento,
  dia_vencimento: cards.dia_vencimento,
  account_id: cards.account_id,
  arquivado: cards.arquivado,
};
type LinhaDeCartao = Omit<Cartao, "fatura_atual" | "proxima_fatura" | "limite_usado">;

/** Totais por fatura: compras menos estornos, e pagamentos (transferencias que entram). */
async function totaisDasFaturas(tx: Tx, uid: string, cardId: string) {
  const linhas = await tx
    .select({
      id: statements.id,
      vencimento: statements.vencimento,
      fechamento: statements.fechamento,
      status: sql<ResumoDeFatura["status"]>`${statements.status}`,
      total_informado: statements.total_informado,
      total: sql<string>`coalesce(sum(case when ${transactions.tipo} = 'despesa' then ${transactions.valor} when ${transactions.tipo} = 'receita' then -${transactions.valor} else 0 end), 0)::numeric(18,2)::text`,
      // Pagamento previsto (gerado no fechamento) ainda nao e pagamento.
      pagamentos: sql<string>`coalesce(sum(case when ${transactions.transferencia_sentido} = 'entrada' and ${transactions.status} <> 'previsto' then ${transactions.valor} else 0 end), 0)::numeric(18,2)::text`,
      lancamentos: sql<number>`count(${transactions.id})::int`,
    })
    .from(statements)
    .leftJoin(
      transactions,
      and(eq(transactions.statement_id, statements.id), eq(transactions.user_id, uid)),
    )
    .where(and(eq(statements.user_id, uid), eq(statements.card_id, cardId)))
    .groupBy(statements.id)
    .orderBy(desc(statements.vencimento));
  return new Map(linhas.map((l) => [l.vencimento, l]));
}

const faturaVazia = (f: Fatura): ResumoDeFatura => ({
  id: null,
  ...f,
  status: "aberta",
  total_informado: null,
  total: "0.00",
  pagamentos: "0.00",
  lancamentos: 0,
});

async function comFaturaAtual(
  tx: Tx,
  uid: string,
  c: LinhaDeCartao,
  hoje: string,
): Promise<Cartao> {
  const atual = faturaDaCompra(c, hoje);
  const proxima = faturaDoMes(
    c,
    Number(atual.vencimento.slice(0, 4)),
    Number(atual.vencimento.slice(5, 7)) + 1,
  );
  const totais = await totaisDasFaturas(tx, uid, c.id);
  // Limite usado: compras menos estornos menos pagamentos feitos, em todas as faturas.
  const [usado] = await tx
    .select({
      v: sql<string>`coalesce(sum(case when ${transactions.tipo} = 'despesa' then ${transactions.valor} when ${transactions.tipo} = 'receita' then -${transactions.valor} when ${transactions.status} <> 'previsto' then -${transactions.valor} else 0 end), 0)::numeric(18,2)::text`,
    })
    .from(transactions)
    .where(and(eq(transactions.user_id, uid), eq(transactions.card_id, c.id)));
  return {
    ...c,
    limite_usado: d(usado?.v ?? "0").lt(0) ? "0.00" : moeda(d(usado?.v ?? "0")),
    fatura_atual: totais.get(atual.vencimento) ?? faturaVazia(atual),
    proxima_fatura: totais.get(proxima.vencimento) ?? faturaVazia(proxima),
  };
}

export async function listarCartoes(
  tx: Tx,
  uid: string,
  hoje: string,
): Promise<Cartao[]> {
  const linhas = await tx
    .select(colunasDeCartao)
    .from(cards)
    .where(eq(cards.user_id, uid))
    .orderBy(asc(cards.arquivado), asc(cards.criado_em));
  return Promise.all(linhas.map((c) => comFaturaAtual(tx, uid, c, hoje)));
}

async function linhaDoCartao(tx: Tx, uid: string, id: string): Promise<LinhaDeCartao> {
  const [c] = await tx
    .select(colunasDeCartao)
    .from(cards)
    .where(and(eq(cards.user_id, uid), eq(cards.id, id)));
  if (!c) throw new ErroDeFinancas(404, "Cartão não encontrado.");
  return c;
}

export async function cartaoDoUsuario(
  tx: Tx,
  uid: string,
  id: string,
  hoje: string,
): Promise<Cartao> {
  return comFaturaAtual(tx, uid, await linhaDoCartao(tx, uid, id), hoje);
}

/** Faturas de 6 ciclos atras ate 2 a frente, mais as antigas que tem lancamento. */
export async function listarFaturas(
  tx: Tx,
  uid: string,
  id: string,
  hoje: string,
): Promise<ResumoDeFatura[]> {
  const c = await linhaDoCartao(tx, uid, id);
  const totais = await totaisDasFaturas(tx, uid, id);
  const porVencimento = new Map<string, ResumoDeFatura>();
  for (const f of faturasAoRedor(c, hoje))
    porVencimento.set(f.vencimento, faturaVazia(f));
  for (const [v, t] of totais) porVencimento.set(v, t);
  return [...porVencimento.values()].sort((a, b) =>
    b.vencimento.localeCompare(a.vencimento),
  );
}

const nomeRepetido = (erro: unknown) => {
  if (unico(erro)) throw new ErroDeFinancas(409, "Já existe um cartão com esse nome.");
  throw erro;
};

export async function criarCartao(
  tx: Tx,
  uid: string,
  c: NovoCartao,
  hoje: string,
  origem?: Origem,
): Promise<Cartao> {
  if (c.account_id) await exigirConta(tx, uid, c.account_id);
  const id = randomUUID();
  await tx
    .insert(cards)
    .values({
      id,
      user_id: uid,
      nome: c.nome,
      instituicao: c.instituicao ?? null,
      final: c.final ?? null,
      limite: c.limite ?? null,
      dia_fechamento: c.dia_fechamento,
      dia_vencimento: c.dia_vencimento,
      account_id: c.account_id ?? null,
    })
    .catch(nomeRepetido);
  await auditar(tx, uid, "cartao.criado", "card", id, origem, c.nome);
  return cartaoDoUsuario(tx, uid, id, hoje);
}

export async function editarCartao(
  tx: Tx,
  uid: string,
  id: string,
  e: EdicaoDeCartao,
  hoje: string,
  origem?: Origem,
): Promise<Cartao> {
  await linhaDoCartao(tx, uid, id);
  if (e.account_id) await exigirConta(tx, uid, e.account_id);
  const mudancas = Object.fromEntries(
    Object.entries(e).filter(([, v]) => v !== undefined),
  ) as Partial<typeof cards.$inferInsert>;
  if (Object.keys(mudancas).length > 0)
    await tx
      .update(cards)
      .set(mudancas)
      .where(and(eq(cards.user_id, uid), eq(cards.id, id)))
      .catch(nomeRepetido);
  await auditar(tx, uid, "cartao.editado", "card", id, origem);
  return cartaoDoUsuario(tx, uid, id, hoje);
}

export async function apagarCartao(
  tx: Tx,
  uid: string,
  id: string,
  origem?: Origem,
): Promise<void> {
  const atual = await linhaDoCartao(tx, uid, id);
  const [uso] = await tx
    .select({ n: count() })
    .from(transactions)
    .where(and(eq(transactions.user_id, uid), eq(transactions.card_id, id)));
  const [importada] = await tx
    .select({ n: count() })
    .from(imports)
    .where(and(eq(imports.user_id, uid), eq(imports.card_id, id)));
  if ((uso?.n ?? 0) + (importada?.n ?? 0) > 0)
    throw new ErroDeFinancas(409, "O cartão tem lançamentos; arquive em vez de apagar.");
  await tx
    .delete(statements)
    .where(and(eq(statements.user_id, uid), eq(statements.card_id, id)));
  await tx.delete(cards).where(and(eq(cards.user_id, uid), eq(cards.id, id)));
  await auditar(tx, uid, "cartao.apagado", "card", id, origem, atual.nome);
}

// Fatura: detalhe, fechamento e pagamento

const colunasDoLancamento = {
  id: transactions.id,
  account_id: transactions.account_id,
  card_id: transactions.card_id,
  statement_id: transactions.statement_id,
  tipo: transactions.tipo,
  valor: transactions.valor,
  data: transactions.data,
  competencia: transactions.competencia,
  descricao: transactions.descricao,
  category_id: transactions.category_id,
  status: transactions.status,
  transferencia_par_id: transactions.transferencia_par_id,
  transferencia_sentido: transactions.transferencia_sentido,
  observacao: transactions.observacao,
};

async function faturaDoCartao(tx: Tx, uid: string, cardId: string, id: string) {
  const [f] = await tx
    .select()
    .from(statements)
    .where(
      and(
        eq(statements.user_id, uid),
        eq(statements.card_id, cardId),
        eq(statements.id, id),
      ),
    );
  if (!f) throw new ErroDeFinancas(404, "Fatura não encontrada.");
  return f;
}

export async function detalheDaFatura(
  tx: Tx,
  uid: string,
  cardId: string,
  id: string,
): Promise<DetalheDaFatura> {
  const c = await linhaDoCartao(tx, uid, cardId);
  const f = await faturaDoCartao(tx, uid, cardId, id);
  const resumo = (await totaisDasFaturas(tx, uid, cardId)).get(
    f.vencimento,
  ) as ResumoDeFatura;
  const lancamentos = (await tx
    .select(colunasDoLancamento)
    .from(transactions)
    .where(and(eq(transactions.user_id, uid), eq(transactions.statement_id, id)))
    .orderBy(asc(transactions.data), asc(transactions.criada_em))) as Lancamento[];
  const nomes = new Map(
    (
      await tx
        .select({ id: categories.id, nome: categories.nome })
        .from(categories)
        .where(eq(categories.user_id, uid))
    ).map((x) => [x.id, x.nome]),
  );
  const porCategoria = new Map<string | null, ReturnType<typeof d>>();
  for (const l of lancamentos) {
    if (l.tipo === "transferencia") continue;
    const v = l.tipo === "despesa" ? d(l.valor) : d(l.valor).neg();
    porCategoria.set(l.category_id, (porCategoria.get(l.category_id) ?? d(0)).plus(v));
  }
  return {
    card_id: cardId,
    fatura: resumo,
    conta_pagadora: c.account_id,
    lancamentos,
    por_categoria: [...porCategoria.entries()]
      .sort((a, b) => b[1].comparedTo(a[1]))
      .map(([cid, v]) => ({
        category_id: cid,
        nome: cid ? (nomes.get(cid) ?? "Categoria") : "Sem categoria",
        valor: moeda(v),
      })),
  };
}

/**
 * Fecha as faturas cujo dia de fechamento ja passou e gera, na conta pagadora,
 * o pagamento previsto (transferencia) no vencimento com o total. Fatura ja
 * fechada com pagamento ainda previsto tem o valor atualizado (compra lancada
 * depois). Idempotente.
 */
export async function fecharFaturas(tx: Tx, uid: string, hoje: string): Promise<number> {
  const abertas = await tx
    .select({
      id: statements.id,
      card_id: statements.card_id,
      vencimento: statements.vencimento,
      fechamento: statements.fechamento,
      status: statements.status,
      pagamento_id: statements.pagamento_id,
      conta: cards.account_id,
      cartao: cards.nome,
    })
    .from(statements)
    .innerJoin(cards, and(eq(cards.id, statements.card_id), eq(cards.user_id, uid)))
    .where(and(eq(statements.user_id, uid), sql`${statements.status} <> 'paga'`));
  let fechadas = 0;
  for (const f of abertas) {
    if (!fechou(f, hoje)) continue;
    const resumo = (await totaisDasFaturas(tx, uid, f.card_id)).get(f.vencimento);
    const aPagar = d(resumo?.total ?? "0").minus(resumo?.pagamentos ?? "0");
    if (f.status === "aberta") {
      fechadas++;
      await tx
        .update(statements)
        .set({ status: "fechada" })
        .where(and(eq(statements.user_id, uid), eq(statements.id, f.id)));
    }
    if (f.pagamento_id) {
      // So o previsto acompanha o total; realizado e do usuario.
      const [saida] = await tx
        .select({ status: transactions.status, par: transactions.transferencia_par_id })
        .from(transactions)
        .where(and(eq(transactions.user_id, uid), eq(transactions.id, f.pagamento_id)));
      if (saida?.status === "previsto" && aPagar.gt(0))
        await tx
          .update(transactions)
          .set({ valor: moeda(aPagar), atualizada_em: sql`now()` })
          .where(
            and(
              eq(transactions.user_id, uid),
              inArray(transactions.id, [f.pagamento_id, saida.par ?? ""]),
            ),
          );
      continue;
    }
    if (!f.conta || aPagar.lte(0)) continue;
    const [s, e] = montarTransferencia(
      {
        de: f.conta,
        para: { card_id: f.card_id, statement_id: f.id },
        valor: moeda(aPagar),
        data: f.vencimento,
        descricao: `Fatura ${f.cartao}`,
        status: "previsto",
      },
      { saida: randomUUID(), entrada: randomUUID() },
    );
    await tx.insert(transactions).values([s, e].map((x) => ({ ...x, user_id: uid })));
    await tx
      .update(statements)
      .set({ pagamento_id: s.id })
      .where(and(eq(statements.user_id, uid), eq(statements.id, f.id)));
  }
  return fechadas;
}

/**
 * Paga a fatura: o previsto do fechamento vira realizado (com a data, o valor e
 * a conta informados), ou nasce a transferencia realizada. Nunca despesa.
 */
export async function pagarFatura(
  tx: Tx,
  uid: string,
  cardId: string,
  id: string,
  p: PagamentoDeFatura,
  origem?: Origem,
): Promise<DetalheDaFatura> {
  const c = await linhaDoCartao(tx, uid, cardId);
  const f = await faturaDoCartao(tx, uid, cardId, id);
  if (f.status === "paga") throw new ErroDeFinancas(409, "Esta fatura já está paga.");
  const conta = p.account_id ?? c.account_id;
  if (!conta) throw new ErroDeFinancas(422, "Escolha a conta que paga a fatura.");
  await exigirConta(tx, uid, conta);
  const resumo = (await totaisDasFaturas(tx, uid, cardId)).get(f.vencimento);
  const aPagar = d(resumo?.total ?? "0").minus(resumo?.pagamentos ?? "0");
  const valor = p.valor ?? moeda(aPagar);
  if (d(valor).lte(0))
    throw new ErroDeFinancas(422, "Não há valor a pagar nesta fatura.");

  const [previsto] = f.pagamento_id
    ? await tx
        .select({
          id: transactions.id,
          par: transactions.transferencia_par_id,
          status: transactions.status,
        })
        .from(transactions)
        .where(and(eq(transactions.user_id, uid), eq(transactions.id, f.pagamento_id)))
    : [];
  let saida: string;
  if (previsto?.status === "previsto" && previsto.par) {
    const comum = {
      valor: moeda(d(valor)),
      data: p.data,
      competencia: `${p.data.slice(0, 7)}-01`,
      status: "realizado",
      atualizada_em: sql`now()`,
    };
    await tx
      .update(transactions)
      .set({ ...comum, account_id: conta })
      .where(and(eq(transactions.user_id, uid), eq(transactions.id, previsto.id)));
    await tx
      .update(transactions)
      .set(comum)
      .where(and(eq(transactions.user_id, uid), eq(transactions.id, previsto.par)));
    saida = previsto.id;
  } else {
    const [s, e] = montarTransferencia(
      {
        de: conta,
        para: { card_id: cardId, statement_id: id },
        valor,
        data: p.data,
        descricao: `Fatura ${c.nome}`,
        status: "realizado",
      },
      { saida: randomUUID(), entrada: randomUUID() },
    );
    await tx.insert(transactions).values([s, e].map((x) => ({ ...x, user_id: uid })));
    saida = s.id;
  }
  // Pagamento parcial deixa a fatura em aberto (fechada); total quita.
  const quitou = d(valor).gte(aPagar);
  await tx
    .update(statements)
    .set({
      pagamento_id: saida,
      ...(quitou ? { status: "paga" } : {}),
    })
    .where(and(eq(statements.user_id, uid), eq(statements.id, id)));
  await auditar(tx, uid, "fatura.paga", "statement", id, origem, moeda(d(valor)));
  return detalheDaFatura(tx, uid, cardId, id);
}
