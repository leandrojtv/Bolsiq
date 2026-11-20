import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { CATEGORIAS_PADRAO } from "../categorias-padrao.js";
import type {
  Categoria,
  Conta,
  EdicaoDeCategoria,
  EdicaoDeConta,
  EdicaoDeLancamento,
  FiltroDeLancamentos,
  Lancamento,
  NovaCategoria,
  NovaConta,
  NovoLancamento,
  PaginaDeLancamentos,
  ResumoDoMes,
} from "../contratos.js";
import { d, moeda } from "../decimal.js";
import {
  competenciaDe,
  montarTransferencia,
  normalizarDescricao,
  totaisDoMes,
} from "../dominio.js";
import {
  competenciaDaFatura,
  faturaDaCompra,
  faturaDoMes,
  type CicloDoCartao,
} from "../cartao.js";
import type { TransacaoDoUsuario } from "./sessao.js";
import {
  accounts,
  audit_log,
  cards,
  categories,
  import_rows,
  imports,
  statements,
  transactions,
} from "./schema.js";

/**
 * Operacoes de banco do Bolsiq Financas. Recebem a transacao ja aberta por
 * `comoUsuario` (RLS valendo) e filtram por usuario mesmo assim: a RLS e a
 * segunda barreira, nao a primeira (ADR 0011).
 */
export type Tx = TransacaoDoUsuario<Record<string, unknown>>;

export class ErroDeFinancas extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export interface Origem {
  ip?: string | null;
  user_agent?: string | null;
}

export async function auditar(
  tx: Tx,
  uid: string,
  acao: string,
  recurso: string,
  recurso_id: string,
  origem: Origem = {},
  detalhe?: string,
): Promise<void> {
  await tx.insert(audit_log).values({
    id: randomUUID(),
    user_id: uid,
    acao,
    recurso,
    recurso_id,
    detalhe: detalhe ?? null,
    ip: origem.ip ?? null,
    user_agent: origem.user_agent?.slice(0, 300) ?? null,
  });
}

export const unico = (erro: unknown) =>
  (erro as { cause?: { code?: string } }).cause?.code === "23505" ||
  (erro as { code?: string }).code === "23505";

// Categorias

/**
 * Semeia as categorias padrao no primeiro acesso. Idempotente: so roda se o
 * usuario nao tem nenhuma de sistema, e mesmo assim `ON CONFLICT DO NOTHING`.
 */
export async function semearCategorias(tx: Tx, uid: string): Promise<number> {
  const [ja] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.user_id, uid), eq(categories.sistema, true)))
    .limit(1);
  if (ja) return 0;
  const inseridas = await tx
    .insert(categories)
    .values(CATEGORIAS_PADRAO.map((c) => ({ ...c, id: randomUUID(), user_id: uid })))
    .onConflictDoNothing()
    .returning({ id: categories.id });
  return inseridas.length;
}

const colunasDeCategoria = {
  id: categories.id,
  parent_id: categories.parent_id,
  nome: categories.nome,
  natureza: categories.natureza,
  tipo_custo: categories.tipo_custo,
  essencial: categories.essencial,
  cor: categories.cor,
  icone: categories.icone,
  sistema: categories.sistema,
  arquivada: categories.arquivada,
};

export async function listarCategorias(tx: Tx, uid: string): Promise<Categoria[]> {
  const linhas = await tx
    .select(colunasDeCategoria)
    .from(categories)
    .where(eq(categories.user_id, uid))
    .orderBy(asc(categories.natureza), asc(categories.nome));
  return linhas as Categoria[];
}

export async function categoriaDoUsuario(
  tx: Tx,
  uid: string,
  id: string,
): Promise<Categoria> {
  const [c] = await tx
    .select(colunasDeCategoria)
    .from(categories)
    .where(and(eq(categories.user_id, uid), eq(categories.id, id)));
  if (!c) throw new ErroDeFinancas(404, "Categoria não encontrada.");
  return c as Categoria;
}

async function validarPai(
  tx: Tx,
  uid: string,
  parentId: string | null | undefined,
  natureza: string,
  propria?: string,
): Promise<void> {
  if (!parentId) return;
  if (parentId === propria)
    throw new ErroDeFinancas(422, "A categoria não pode ser mãe dela mesma.");
  const pai = await categoriaDoUsuario(tx, uid, parentId);
  if (pai.parent_id !== null)
    throw new ErroDeFinancas(422, "Subcategoria só vai embaixo de categoria principal.");
  if (pai.natureza !== natureza)
    throw new ErroDeFinancas(422, "Subcategoria precisa ter a mesma natureza da mãe.");
}

export async function criarCategoria(
  tx: Tx,
  uid: string,
  c: NovaCategoria,
  origem?: Origem,
): Promise<Categoria> {
  await validarPai(tx, uid, c.parent_id, c.natureza);
  const id = randomUUID();
  try {
    await tx.insert(categories).values({
      id,
      user_id: uid,
      parent_id: c.parent_id ?? null,
      nome: c.nome,
      natureza: c.natureza,
      tipo_custo: c.tipo_custo,
      essencial: c.essencial,
      cor: c.cor ?? null,
      icone: c.icone ?? null,
    });
  } catch (erro) {
    if (unico(erro))
      throw new ErroDeFinancas(409, "Já existe uma categoria com esse nome.");
    throw erro;
  }
  await auditar(tx, uid, "categoria.criada", "category", id, origem, c.nome);
  return categoriaDoUsuario(tx, uid, id);
}

export async function editarCategoria(
  tx: Tx,
  uid: string,
  id: string,
  e: EdicaoDeCategoria,
  origem?: Origem,
): Promise<Categoria> {
  const atual = await categoriaDoUsuario(tx, uid, id);
  if (atual.sistema && e.natureza !== undefined && e.natureza !== atual.natureza)
    throw new ErroDeFinancas(409, "Categoria do sistema não troca de natureza.");
  if (e.parent_id !== undefined || e.natureza !== undefined)
    await validarPai(
      tx,
      uid,
      e.parent_id === undefined ? atual.parent_id : e.parent_id,
      e.natureza ?? atual.natureza,
      id,
    );
  const mudancas = Object.fromEntries(
    Object.entries(e).filter(([, v]) => v !== undefined),
  ) as Partial<typeof categories.$inferInsert>;
  if (Object.keys(mudancas).length > 0) {
    try {
      await tx
        .update(categories)
        .set(mudancas)
        .where(and(eq(categories.user_id, uid), eq(categories.id, id)));
    } catch (erro) {
      if (unico(erro))
        throw new ErroDeFinancas(409, "Já existe uma categoria com esse nome.");
      throw erro;
    }
  }
  await auditar(tx, uid, "categoria.editada", "category", id, origem);
  return categoriaDoUsuario(tx, uid, id);
}

export async function apagarCategoria(
  tx: Tx,
  uid: string,
  id: string,
  origem?: Origem,
): Promise<void> {
  const atual = await categoriaDoUsuario(tx, uid, id);
  if (atual.sistema)
    throw new ErroDeFinancas(409, "Categoria do sistema não pode ser apagada; arquive.");
  // FK composta sem ON DELETE: solta lancamentos, linhas de importacao e
  // subcategorias antes. As regras da categoria saem em cascata.
  await tx
    .update(transactions)
    .set({ category_id: null, atualizada_em: sql`now()` })
    .where(and(eq(transactions.user_id, uid), eq(transactions.category_id, id)));
  await tx
    .update(import_rows)
    .set({ category_id: null })
    .where(and(eq(import_rows.user_id, uid), eq(import_rows.category_id, id)));
  await tx
    .update(categories)
    .set({ parent_id: null })
    .where(and(eq(categories.user_id, uid), eq(categories.parent_id, id)));
  await tx
    .delete(categories)
    .where(and(eq(categories.user_id, uid), eq(categories.id, id)));
  await auditar(tx, uid, "categoria.apagada", "category", id, origem, atual.nome);
}

// Contas

/**
 * Saldo realizado ate `hoje`, com a mesma regra de `saldoNaData`. Nomes
 * qualificados a mao: dentro do `sql` o Drizzle pode omitir a tabela, e o
 * subselect correlacionado compararia `transactions` com ela mesma.
 */
function saldoAte(hoje: string) {
  return sql<string>`(${accounts.saldo_inicial} + coalesce((
    select sum(case
        when t.tipo = 'receita' then t.valor
        when t.tipo = 'despesa' then -t.valor
        when t.transferencia_sentido = 'entrada' then t.valor
        else -t.valor end)
      from finance.transactions t
     where t.account_id = "accounts"."id"
       and t.user_id = "accounts"."user_id"
       and t.status in ('realizado', 'conciliado')
       and t.data >= "accounts"."data_saldo_inicial"
       and t.data <= ${hoje}::date
  ), 0))::numeric(18,2)::text`;
}

const colunasDeConta = (hoje: string) => ({
  id: accounts.id,
  nome: accounts.nome,
  tipo: accounts.tipo,
  instituicao: accounts.instituicao,
  saldo_inicial: accounts.saldo_inicial,
  data_saldo_inicial: accounts.data_saldo_inicial,
  cor: accounts.cor,
  arquivada: accounts.arquivada,
  saldo_atual: saldoAte(hoje),
});

/** Saldo realizado da conta no fim de `data`. */
export async function saldoDaConta(
  tx: Tx,
  uid: string,
  id: string,
  data: string,
): Promise<string> {
  return (await contaDoUsuario(tx, uid, id, data)).saldo_atual;
}

export async function listarContas(tx: Tx, uid: string, hoje: string): Promise<Conta[]> {
  const linhas = await tx
    .select(colunasDeConta(hoje))
    .from(accounts)
    .where(eq(accounts.user_id, uid))
    .orderBy(asc(accounts.arquivada), asc(accounts.criada_em));
  return linhas as Conta[];
}

async function contaDoUsuario(
  tx: Tx,
  uid: string,
  id: string,
  hoje: string,
): Promise<Conta> {
  const [c] = await tx
    .select(colunasDeConta(hoje))
    .from(accounts)
    .where(and(eq(accounts.user_id, uid), eq(accounts.id, id)));
  if (!c) throw new ErroDeFinancas(404, "Conta não encontrada.");
  return c as Conta;
}

export async function criarConta(
  tx: Tx,
  uid: string,
  c: NovaConta,
  hoje: string,
  origem?: Origem,
): Promise<Conta> {
  const id = randomUUID();
  try {
    await tx.insert(accounts).values({
      id,
      user_id: uid,
      nome: c.nome,
      tipo: c.tipo,
      instituicao: c.instituicao ?? null,
      saldo_inicial: moeda(d(c.saldo_inicial)),
      data_saldo_inicial: c.data_saldo_inicial,
      cor: c.cor ?? null,
    });
  } catch (erro) {
    if (unico(erro)) throw new ErroDeFinancas(409, "Já existe uma conta com esse nome.");
    throw erro;
  }
  await auditar(tx, uid, "conta.criada", "account", id, origem, c.nome);
  return contaDoUsuario(tx, uid, id, hoje);
}

export async function editarConta(
  tx: Tx,
  uid: string,
  id: string,
  e: EdicaoDeConta,
  hoje: string,
  origem?: Origem,
): Promise<Conta> {
  await contaDoUsuario(tx, uid, id, hoje);
  const mudancas = Object.fromEntries(
    Object.entries(e).filter(([, v]) => v !== undefined),
  ) as Partial<typeof accounts.$inferInsert>;
  if (mudancas.saldo_inicial !== undefined)
    mudancas.saldo_inicial = moeda(d(mudancas.saldo_inicial));
  if (Object.keys(mudancas).length > 0) {
    try {
      await tx
        .update(accounts)
        .set(mudancas)
        .where(and(eq(accounts.user_id, uid), eq(accounts.id, id)));
    } catch (erro) {
      if (unico(erro))
        throw new ErroDeFinancas(409, "Já existe uma conta com esse nome.");
      throw erro;
    }
  }
  await auditar(tx, uid, "conta.editada", "account", id, origem);
  return contaDoUsuario(tx, uid, id, hoje);
}

export async function apagarConta(
  tx: Tx,
  uid: string,
  id: string,
  hoje: string,
  origem?: Origem,
): Promise<void> {
  const atual = await contaDoUsuario(tx, uid, id, hoje);
  const [uso] = await tx
    .select({ n: count() })
    .from(transactions)
    .where(and(eq(transactions.user_id, uid), eq(transactions.account_id, id)));
  if ((uso?.n ?? 0) > 0)
    throw new ErroDeFinancas(409, "A conta tem lançamentos; arquive em vez de apagar.");
  const [importada] = await tx
    .select({ id: imports.id })
    .from(imports)
    .where(and(eq(imports.user_id, uid), eq(imports.account_id, id)))
    .limit(1);
  if (importada)
    throw new ErroDeFinancas(409, "A conta tem importações; arquive em vez de apagar.");
  // Cartao que costumava pagar por ela fica sem conta de pagamento.
  await tx
    .update(cards)
    .set({ account_id: null })
    .where(and(eq(cards.user_id, uid), eq(cards.account_id, id)));
  await tx.delete(accounts).where(and(eq(accounts.user_id, uid), eq(accounts.id, id)));
  await auditar(tx, uid, "conta.apagada", "account", id, origem, atual.nome);
}

// Lancamentos

const colunasDeLancamento = {
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

export async function listarLancamentos(
  tx: Tx,
  uid: string,
  f: FiltroDeLancamentos,
): Promise<PaginaDeLancamentos> {
  const termo = f.q ? normalizarDescricao(f.q) : "";
  const filtro = and(
    eq(transactions.user_id, uid),
    f.de ? gte(transactions.data, f.de) : undefined,
    f.ate ? lte(transactions.data, f.ate) : undefined,
    f.conta ? eq(transactions.account_id, f.conta) : undefined,
    f.cartao ? eq(transactions.card_id, f.cartao) : undefined,
    f.fatura ? eq(transactions.statement_id, f.fatura) : undefined,
    f.importacao ? eq(transactions.importacao_id, f.importacao) : undefined,
    f.categoria ? eq(transactions.category_id, f.categoria) : undefined,
    f.status ? eq(transactions.status, f.status) : undefined,
    f.q
      ? or(
          ilike(transactions.descricao, `%${f.q.replace(/[%_\\]/g, "\\$&")}%`),
          termo ? ilike(transactions.descricao_normalizada, `%${termo}%`) : undefined,
        )
      : undefined,
  );
  const [total] = await tx.select({ n: count() }).from(transactions).where(filtro);
  const linhas = await tx
    .select(colunasDeLancamento)
    .from(transactions)
    .where(filtro)
    .orderBy(desc(transactions.data), desc(transactions.criada_em), asc(transactions.id))
    .limit(f.por_pagina)
    .offset((f.pagina - 1) * f.por_pagina);
  return {
    data: linhas as Lancamento[],
    meta: { pagina: f.pagina, por_pagina: f.por_pagina, total: total?.n ?? 0 },
  };
}

async function lancamentoDoUsuario(tx: Tx, uid: string, id: string): Promise<Lancamento> {
  const [l] = await tx
    .select(colunasDeLancamento)
    .from(transactions)
    .where(and(eq(transactions.user_id, uid), eq(transactions.id, id)));
  if (!l) throw new ErroDeFinancas(404, "Lançamento não encontrado.");
  return l as Lancamento;
}

export async function exigirConta(tx: Tx, uid: string, id: string): Promise<void> {
  const [c] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.user_id, uid), eq(accounts.id, id)));
  if (!c) throw new ErroDeFinancas(404, "Conta não encontrada.");
}

export async function exigirCartao(
  tx: Tx,
  uid: string,
  id: string,
): Promise<CicloDoCartao> {
  const [c] = await tx
    .select({
      dia_fechamento: cards.dia_fechamento,
      dia_vencimento: cards.dia_vencimento,
    })
    .from(cards)
    .where(and(eq(cards.user_id, uid), eq(cards.id, id)));
  if (!c) throw new ErroDeFinancas(404, "Cartão não encontrado.");
  return c;
}

/** A fatura do cartao que vence em `vencimento`, criada se ainda nao existe. */
export async function obterFatura(
  tx: Tx,
  uid: string,
  cardId: string,
  vencimento: string,
): Promise<string> {
  const ciclo = await exigirCartao(tx, uid, cardId);
  const f = faturaDoMes(
    ciclo,
    Number(vencimento.slice(0, 4)),
    Number(vencimento.slice(5, 7)),
  );
  await tx
    .insert(statements)
    .values({
      id: randomUUID(),
      user_id: uid,
      card_id: cardId,
      ...f,
      competencia: competenciaDaFatura(f),
    })
    .onConflictDoNothing();
  const [s] = await tx
    .select({ id: statements.id })
    .from(statements)
    .where(
      and(
        eq(statements.user_id, uid),
        eq(statements.card_id, cardId),
        eq(statements.vencimento, f.vencimento),
      ),
    );
  /* c8 ignore next */
  if (!s) throw new ErroDeFinancas(404, "Fatura não encontrada.");
  return s.id;
}

/** A fatura em que entra uma compra ou pagamento do cartao feito em `data`. */
export async function faturaDaData(
  tx: Tx,
  uid: string,
  cardId: string,
  data: string,
): Promise<string> {
  const ciclo = await exigirCartao(tx, uid, cardId);
  return obterFatura(tx, uid, cardId, faturaDaCompra(ciclo, data).vencimento);
}

async function exigirCategoriaCompativel(
  tx: Tx,
  uid: string,
  id: string | null | undefined,
  tipo: string,
): Promise<void> {
  if (!id) return;
  const c = await categoriaDoUsuario(tx, uid, id);
  if (c.natureza !== tipo)
    throw new ErroDeFinancas(
      422,
      tipo === "receita"
        ? "Escolha uma categoria de receita."
        : "Escolha uma categoria de despesa.",
    );
}

/**
 * Cria receita ou despesa, ou o par da transferencia. A transferencia grava os
 * dois lados nesta mesma transacao: ou existem os dois, ou nenhum.
 */
export async function criarLancamento(
  tx: Tx,
  uid: string,
  l: NovoLancamento,
  origem?: Origem,
): Promise<Lancamento[]> {
  if (l.account_id) await exigirConta(tx, uid, l.account_id);
  if (l.tipo === "transferencia") {
    if (!l.account_id) throw new ErroDeFinancas(422, "Transferência sai de uma conta.");
    let para: Parameters<typeof montarTransferencia>[0]["para"];
    if (l.cartao_destino_id) {
      para = {
        card_id: l.cartao_destino_id,
        statement_id: await faturaDaData(tx, uid, l.cartao_destino_id, l.data),
      };
    } else {
      await exigirConta(tx, uid, l.conta_destino_id ?? "");
      para = l.conta_destino_id ?? "";
    }
    const lados = montarTransferencia(
      {
        de: l.account_id,
        para,
        valor: l.valor,
        data: l.data,
        descricao: l.descricao,
        status: l.status,
        observacao: l.observacao ?? null,
      },
      { saida: randomUUID(), entrada: randomUUID() },
    );
    await tx.insert(transactions).values(lados.map((x) => ({ ...x, user_id: uid })));
    await auditar(
      tx,
      uid,
      "lancamento.transferencia",
      "transaction",
      lados[0].id,
      origem,
    );
    return Promise.all(lados.map((x) => lancamentoDoUsuario(tx, uid, x.id)));
  }
  await exigirCategoriaCompativel(tx, uid, l.category_id, l.tipo);
  const id = randomUUID();
  await tx.insert(transactions).values({
    id,
    user_id: uid,
    account_id: l.account_id ?? null,
    card_id: l.card_id ?? null,
    statement_id: l.card_id ? await faturaDaData(tx, uid, l.card_id, l.data) : null,
    tipo: l.tipo,
    valor: moeda(d(l.valor)),
    data: l.data,
    competencia: competenciaDe(l.data),
    descricao: l.descricao,
    descricao_normalizada: normalizarDescricao(l.descricao),
    category_id: l.category_id ?? null,
    status: l.status,
    observacao: l.observacao ?? null,
  });
  await auditar(tx, uid, "lancamento.criado", "transaction", id, origem);
  return [await lancamentoDoUsuario(tx, uid, id)];
}

export async function editarLancamento(
  tx: Tx,
  uid: string,
  id: string,
  e: EdicaoDeLancamento,
  origem?: Origem,
): Promise<Lancamento> {
  const atual = await lancamentoDoUsuario(tx, uid, id);
  const comum: Partial<typeof transactions.$inferInsert> = {};
  if (e.valor !== undefined) comum.valor = moeda(d(e.valor));
  if (e.data !== undefined) {
    comum.data = e.data;
    comum.competencia = competenciaDe(e.data);
  }
  if (e.descricao !== undefined) {
    comum.descricao = e.descricao;
    comum.descricao_normalizada = normalizarDescricao(e.descricao);
  }
  if (e.status !== undefined) comum.status = e.status;
  if (e.observacao !== undefined) comum.observacao = e.observacao;

  if (atual.tipo === "transferencia") {
    if (e.category_id) throw new ErroDeFinancas(422, "Transferência não tem categoria.");
    // Trocar a conta de um lado so: a outra ponta continua a mesma.
    const proprio: Partial<typeof transactions.$inferInsert> = {};
    if (e.account_id !== undefined && e.account_id !== atual.account_id) {
      if (atual.card_id)
        throw new ErroDeFinancas(422, "Este lado da transferência é um cartão.");
      await exigirConta(tx, uid, e.account_id);
      const par = await lancamentoDoUsuario(tx, uid, atual.transferencia_par_id ?? "");
      if (par.account_id === e.account_id)
        throw new ErroDeFinancas(422, "Origem e destino iguais.");
      proprio.account_id = e.account_id;
    }
    const ids = [id, atual.transferencia_par_id ?? ""];
    if (Object.keys(comum).length > 0)
      await tx
        .update(transactions)
        .set({ ...comum, atualizada_em: sql`now()` })
        .where(and(eq(transactions.user_id, uid), inArray(transactions.id, ids)));
    if (Object.keys(proprio).length > 0)
      await tx
        .update(transactions)
        .set({ ...proprio, atualizada_em: sql`now()` })
        .where(and(eq(transactions.user_id, uid), eq(transactions.id, id)));
  } else {
    if (e.account_id !== undefined && e.account_id !== atual.account_id) {
      if (atual.card_id)
        throw new ErroDeFinancas(422, "Lançamento de cartão não muda para conta.");
      await exigirConta(tx, uid, e.account_id);
      comum.account_id = e.account_id;
    }
    if (e.category_id !== undefined) {
      await exigirCategoriaCompativel(tx, uid, e.category_id, atual.tipo);
      comum.category_id = e.category_id;
    }
    if (Object.keys(comum).length > 0)
      await tx
        .update(transactions)
        .set({ ...comum, atualizada_em: sql`now()` })
        .where(and(eq(transactions.user_id, uid), eq(transactions.id, id)));
  }
  await auditar(tx, uid, "lancamento.editado", "transaction", id, origem);
  return lancamentoDoUsuario(tx, uid, id);
}

export async function apagarLancamento(
  tx: Tx,
  uid: string,
  id: string,
  origem?: Origem,
): Promise<void> {
  const atual = await lancamentoDoUsuario(tx, uid, id);
  const ids = atual.transferencia_par_id ? [id, atual.transferencia_par_id] : [id];
  await tx
    .delete(transactions)
    .where(and(eq(transactions.user_id, uid), inArray(transactions.id, ids)));
  await auditar(tx, uid, "lancamento.apagado", "transaction", id, origem);
}

/** Totais do mes (`YYYY-MM-01`) e saldo de cada conta ativa no fim de `hoje`. */
export async function resumoDoMes(
  tx: Tx,
  uid: string,
  competencia: string,
  hoje: string,
): Promise<ResumoDoMes> {
  const doMes = await tx
    .select({
      tipo: transactions.tipo,
      valor: transactions.valor,
      competencia: transactions.competencia,
      status: transactions.status,
    })
    .from(transactions)
    .where(and(eq(transactions.user_id, uid), eq(transactions.competencia, competencia)));
  const contas = await listarContas(tx, uid, hoje);
  return {
    ...totaisDoMes(doMes as Parameters<typeof totaisDoMes>[0], competencia),
    contas: contas
      .filter((c) => !c.arquivada)
      .map((c) => ({ id: c.id, nome: c.nome, saldo: c.saldo_atual })),
  };
}
