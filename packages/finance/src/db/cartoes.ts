import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { faturaDaCompra, faturasAoRedor, type Fatura } from "../cartao.js";
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
import { cards, imports, statements, transactions } from "./schema.js";

const colunasDeCartao = {
  id: cards.id,
  nome: cards.nome,
  instituicao: cards.instituicao,
  final: cards.final,
  limite: cards.limite,
  dia_fechamento: cards.dia_fechamento,
  dia_vencimento: cards.dia_vencimento,
  account_id: cards.account_id,
  arquivado: cards.arquivado,
};
type LinhaDeCartao = Omit<Cartao, "fatura_atual">;

/** Totais por fatura: compras menos estornos, e pagamentos (transferencias que entram). */
async function totaisDasFaturas(tx: Tx, uid: string, cardId: string) {
  const linhas = await tx
    .select({
      id: statements.id,
      vencimento: statements.vencimento,
      fechamento: statements.fechamento,
      total: sql<string>`coalesce(sum(case when ${transactions.tipo} = 'despesa' then ${transactions.valor} when ${transactions.tipo} = 'receita' then -${transactions.valor} else 0 end), 0)::numeric(18,2)::text`,
      pagamentos: sql<string>`coalesce(sum(case when ${transactions.transferencia_sentido} = 'entrada' then ${transactions.valor} else 0 end), 0)::numeric(18,2)::text`,
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
  const totais = await totaisDasFaturas(tx, uid, c.id);
  return { ...c, fatura_atual: totais.get(atual.vencimento) ?? faturaVazia(atual) };
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
