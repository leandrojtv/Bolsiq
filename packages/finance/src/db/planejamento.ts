import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type {
  EdicaoDeItemDoPlanejamento,
  ItemDoPlanejamento,
  NovoItemDoPlanejamento,
  Planejamento,
} from "../contratos-planejamento.js";
import { d, moeda } from "../decimal.js";
import { compararPlanejamento } from "../planejamento.js";
import { vezesNoMes, type RegraDeRecorrencia } from "../recorrencia.js";
import {
  auditar,
  categoriaDoUsuario,
  ErroDeFinancas,
  unico,
  type Origem,
  type Tx,
} from "./operacoes.js";
import { budget_items, categories, recurrences, transactions } from "./schema.js";

/**
 * Planejamento mensal (orcamento). Le os lancamentos para comparar, mas nunca
 * cria nem altera nenhum.
 */

const colunas = {
  id: budget_items.id,
  category_id: budget_items.category_id,
  descricao: budget_items.descricao,
  valor: budget_items.valor,
  fixo: budget_items.fixo,
  recurrence_id: budget_items.recurrence_id,
};

const competenciaDoMes = (mes: string) => `${mes}-01`;

export async function obterPlanejamento(
  tx: Tx,
  uid: string,
  mes: string,
): Promise<Planejamento> {
  const competencia = competenciaDoMes(mes);
  const itens = (await tx
    .select(colunas)
    .from(budget_items)
    .where(and(eq(budget_items.user_id, uid), eq(budget_items.competencia, competencia)))
    .orderBy(asc(budget_items.criado_em))) as ItemDoPlanejamento[];
  const movimentos = await tx
    .select({
      category_id: sql<string>`${transactions.category_id}`,
      realizado: sql<string>`coalesce(sum(case when ${transactions.status} <> 'previsto' then ${transactions.valor} else 0 end), 0)::numeric(18,2)::text`,
      previsto: sql<string>`coalesce(sum(case when ${transactions.status} = 'previsto' then ${transactions.valor} else 0 end), 0)::numeric(18,2)::text`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, uid),
        eq(transactions.competencia, competencia),
        sql`${transactions.category_id} is not null`,
        sql`${transactions.tipo} <> 'transferencia'`,
      ),
    )
    .groupBy(transactions.category_id);
  const cats = await tx
    .select({ id: categories.id, nome: categories.nome, natureza: categories.natureza })
    .from(categories)
    .where(eq(categories.user_id, uid));
  const comparacao = compararPlanejamento(
    itens,
    movimentos,
    new Map(
      cats.map((c) => [
        c.id,
        { nome: c.nome, natureza: c.natureza as "receita" | "despesa" },
      ]),
    ),
  );
  return { competencia, itens, ...comparacao };
}

const repetido = (erro: unknown) => {
  if (unico(erro))
    throw new ErroDeFinancas(
      409,
      "Já existe um item com essa categoria e descrição no mês.",
    );
  throw erro;
};

async function itemDoUsuario(tx: Tx, uid: string, id: string) {
  const [i] = await tx
    .select({ ...colunas, competencia: budget_items.competencia })
    .from(budget_items)
    .where(and(eq(budget_items.user_id, uid), eq(budget_items.id, id)));
  if (!i) throw new ErroDeFinancas(404, "Item não encontrado.");
  return i;
}

export async function criarItem(
  tx: Tx,
  uid: string,
  i: NovoItemDoPlanejamento,
  origem?: Origem,
): Promise<Planejamento> {
  await categoriaDoUsuario(tx, uid, i.category_id);
  const id = randomUUID();
  await tx
    .insert(budget_items)
    .values({
      id,
      user_id: uid,
      competencia: competenciaDoMes(i.mes),
      category_id: i.category_id,
      descricao: i.descricao ?? null,
      valor: moeda(d(i.valor)),
      fixo: i.fixo,
    })
    .catch(repetido);
  await auditar(tx, uid, "planejamento.item_criado", "budget_item", id, origem);
  return obterPlanejamento(tx, uid, i.mes);
}

export async function editarItem(
  tx: Tx,
  uid: string,
  id: string,
  e: EdicaoDeItemDoPlanejamento,
  origem?: Origem,
): Promise<Planejamento> {
  const atual = await itemDoUsuario(tx, uid, id);
  if (e.category_id) await categoriaDoUsuario(tx, uid, e.category_id);
  const mudar = Object.fromEntries(
    Object.entries({ ...e, valor: e.valor ? moeda(d(e.valor)) : undefined }).filter(
      ([, v]) => v !== undefined,
    ),
  ) as Partial<typeof budget_items.$inferInsert>;
  if (Object.keys(mudar).length > 0)
    await tx
      .update(budget_items)
      .set(mudar)
      .where(and(eq(budget_items.user_id, uid), eq(budget_items.id, id)))
      .catch(repetido);
  await auditar(tx, uid, "planejamento.item_editado", "budget_item", id, origem);
  return obterPlanejamento(tx, uid, atual.competencia.slice(0, 7));
}

export async function apagarItem(
  tx: Tx,
  uid: string,
  id: string,
  origem?: Origem,
): Promise<Planejamento> {
  const atual = await itemDoUsuario(tx, uid, id);
  await tx
    .delete(budget_items)
    .where(and(eq(budget_items.user_id, uid), eq(budget_items.id, id)));
  await auditar(tx, uid, "planejamento.item_apagado", "budget_item", id, origem);
  return obterPlanejamento(tx, uid, atual.competencia.slice(0, 7));
}

/** Copia os itens de um mes para outro. O que ja existe no destino fica. */
export async function copiarPlanejamento(
  tx: Tx,
  uid: string,
  de: string,
  para: string,
  origem?: Origem,
): Promise<number> {
  if (de === para) throw new ErroDeFinancas(422, "Escolha meses diferentes.");
  const itens = await tx
    .select(colunas)
    .from(budget_items)
    .where(
      and(
        eq(budget_items.user_id, uid),
        eq(budget_items.competencia, competenciaDoMes(de)),
      ),
    );
  if (itens.length === 0) return 0;
  const inseridos = await tx
    .insert(budget_items)
    .values(
      itens.map((i) => ({
        ...i,
        id: randomUUID(),
        user_id: uid,
        competencia: competenciaDoMes(para),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: budget_items.id });
  await auditar(tx, uid, "planejamento.copiado", "budget_item", para, origem, de);
  return inseridos.length;
}

/**
 * Puxa as recorrencias ativas com categoria como itens fixos do mes, pelo
 * valor do mes (semanal soma as semanas). Nao duplica.
 */
export async function puxarRecorrencias(
  tx: Tx,
  uid: string,
  mes: string,
  origem?: Origem,
): Promise<number> {
  const competencia = competenciaDoMes(mes);
  const ativas = await tx
    .select()
    .from(recurrences)
    .where(and(eq(recurrences.user_id, uid), eq(recurrences.ativa, true)));
  const itens = ativas
    .filter((r) => r.category_id)
    .map((r) => ({
      r,
      vezes: vezesNoMes(
        {
          frequencia: r.frequencia as RegraDeRecorrencia["frequencia"],
          dia: r.dia,
          inicio: r.inicio,
          fim: r.fim,
        },
        competencia,
      ),
    }))
    .filter((x) => x.vezes > 0)
    .map(({ r, vezes }) => ({
      id: randomUUID(),
      user_id: uid,
      competencia,
      category_id: r.category_id as string,
      descricao: r.descricao,
      valor: moeda(d(r.valor).times(vezes)),
      fixo: true,
      recurrence_id: r.id,
    }));
  if (itens.length === 0) return 0;
  const inseridos = await tx
    .insert(budget_items)
    .values(itens)
    .onConflictDoNothing()
    .returning({ id: budget_items.id });
  await auditar(tx, uid, "planejamento.recorrencias", "budget_item", competencia, origem);
  return inseridos.length;
}
