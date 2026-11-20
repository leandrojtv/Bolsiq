import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type {
  EdicaoDeRecorrencia,
  ListaDeRecorrencias,
  NovaRecorrencia,
  Recorrencia,
} from "../contratos-planejamento.js";
import { d, moeda } from "../decimal.js";
import { competenciaDe, normalizarDescricao } from "../dominio.js";
import { ocorrencias, somarDias, type RegraDeRecorrencia } from "../recorrencia.js";
import {
  auditar,
  categoriaDoUsuario,
  ErroDeFinancas,
  exigirCartao,
  exigirConta,
  faturaDaData,
  type Origem,
  type Tx,
} from "./operacoes.js";
import { recurrences, transactions } from "./schema.js";

/** Ate quantos dias a frente o job gera os previstos. */
export const HORIZONTE_DE_RECORRENCIA = 90;

type LinhaDeRecorrencia = typeof recurrences.$inferSelect;

const regra = (r: LinhaDeRecorrencia): RegraDeRecorrencia => ({
  frequencia: r.frequencia as RegraDeRecorrencia["frequencia"],
  dia: r.dia,
  inicio: r.inicio,
  fim: r.fim,
});

/** Valor de um mes cheio: semanal conta 52 semanas em 12 meses; anual, um doze avos. */
function valorMensal(r: LinhaDeRecorrencia): string {
  const v = d(r.valor);
  if (r.frequencia === "semanal") return moeda(v.times(52).div(12));
  if (r.frequencia === "anual") return moeda(v.div(12));
  return moeda(v);
}

function paraResposta(r: LinhaDeRecorrencia, hoje: string): Recorrencia {
  const proxima = r.ativa
    ? (ocorrencias(regra(r), hoje, somarDias(hoje, 400))[0] ?? null)
    : null;
  return {
    id: r.id,
    tipo: r.tipo as Recorrencia["tipo"],
    descricao: r.descricao,
    valor: r.valor,
    category_id: r.category_id,
    account_id: r.account_id,
    card_id: r.card_id,
    frequencia: r.frequencia as Recorrencia["frequencia"],
    dia: r.dia,
    inicio: r.inicio,
    fim: r.fim,
    valor_variavel: r.valor_variavel,
    ativa: r.ativa,
    valor_mensal: valorMensal(r),
    proxima,
  };
}

async function linhaDaRecorrencia(tx: Tx, uid: string, id: string) {
  const [r] = await tx
    .select()
    .from(recurrences)
    .where(and(eq(recurrences.user_id, uid), eq(recurrences.id, id)));
  if (!r) throw new ErroDeFinancas(404, "Recorrência não encontrada.");
  return r;
}

export async function listarRecorrencias(
  tx: Tx,
  uid: string,
  hoje: string,
): Promise<ListaDeRecorrencias> {
  const linhas = await tx
    .select()
    .from(recurrences)
    .where(eq(recurrences.user_id, uid))
    .orderBy(desc(recurrences.ativa), asc(recurrences.tipo), asc(recurrences.descricao));
  let receitas = d(0);
  let despesas = d(0);
  for (const r of linhas) {
    if (!r.ativa || (r.fim && r.fim < hoje)) continue;
    if (r.tipo === "receita") receitas = receitas.plus(valorMensal(r));
    else despesas = despesas.plus(valorMensal(r));
  }
  return {
    data: linhas.map((r) => paraResposta(r, hoje)),
    totais: { receitas_mensais: moeda(receitas), despesas_mensais: moeda(despesas) },
  };
}

/** Valor do previsto: o ultimo realizado, se o valor varia; senao, o da recorrencia. */
async function valorDoPrevisto(tx: Tx, uid: string, r: LinhaDeRecorrencia) {
  if (!r.valor_variavel) return r.valor;
  const [ultimo] = await tx
    .select({ valor: transactions.valor })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, uid),
        eq(transactions.recurrence_id, r.id),
        sql`${transactions.status} <> 'previsto'`,
      ),
    )
    .orderBy(desc(transactions.data))
    .limit(1);
  return ultimo?.valor ?? r.valor;
}

/**
 * Gera os previstos de hoje ate o horizonte. Idempotente: o indice unico
 * (recurrence_id, data) descarta o que ja existe. Com valor variavel, os
 * previstos futuros passam a usar o ultimo realizado.
 */
export async function gerarPrevistos(
  tx: Tx,
  uid: string,
  hoje: string,
  so?: string,
): Promise<number> {
  const ativas = await tx
    .select()
    .from(recurrences)
    .where(
      and(
        eq(recurrences.user_id, uid),
        eq(recurrences.ativa, true),
        so ? eq(recurrences.id, so) : undefined,
      ),
    );
  const ate = somarDias(hoje, HORIZONTE_DE_RECORRENCIA);
  let gerados = 0;
  for (const r of ativas) {
    const valor = await valorDoPrevisto(tx, uid, r);
    if (r.valor_variavel)
      await tx
        .update(transactions)
        .set({ valor, atualizada_em: sql`now()` })
        .where(
          and(
            eq(transactions.user_id, uid),
            eq(transactions.recurrence_id, r.id),
            eq(transactions.status, "previsto"),
            gte(transactions.data, hoje),
          ),
        );
    const datas = ocorrencias(regra(r), hoje, ate);
    if (datas.length === 0) continue;
    const linhas = [];
    for (const data of datas)
      linhas.push({
        id: randomUUID(),
        user_id: uid,
        account_id: r.account_id,
        card_id: r.card_id,
        statement_id: r.card_id ? await faturaDaData(tx, uid, r.card_id, data) : null,
        tipo: r.tipo,
        valor,
        data,
        competencia: competenciaDe(data),
        descricao: r.descricao,
        descricao_normalizada: normalizarDescricao(r.descricao),
        category_id: r.category_id,
        status: "previsto",
        recurrence_id: r.id,
      });
    const inseridos = await tx
      .insert(transactions)
      .values(linhas)
      .onConflictDoNothing()
      .returning({ id: transactions.id });
    gerados += inseridos.length;
  }
  return gerados;
}

/** Apaga os previstos futuros (nao realizados) da recorrencia. */
async function apagarPrevistosFuturos(tx: Tx, uid: string, id: string, hoje: string) {
  await tx
    .delete(transactions)
    .where(
      and(
        eq(transactions.user_id, uid),
        eq(transactions.recurrence_id, id),
        eq(transactions.status, "previsto"),
        gte(transactions.data, hoje),
      ),
    );
}

async function validarCategoria(
  tx: Tx,
  uid: string,
  id: string | null | undefined,
  tipo: string,
) {
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

export async function criarRecorrencia(
  tx: Tx,
  uid: string,
  r: NovaRecorrencia,
  hoje: string,
  origem?: Origem,
): Promise<Recorrencia> {
  if (r.account_id) await exigirConta(tx, uid, r.account_id);
  if (r.card_id) await exigirCartao(tx, uid, r.card_id);
  await validarCategoria(tx, uid, r.category_id, r.tipo);
  const id = randomUUID();
  await tx.insert(recurrences).values({
    id,
    user_id: uid,
    tipo: r.tipo,
    descricao: r.descricao,
    valor: moeda(d(r.valor)),
    category_id: r.category_id ?? null,
    account_id: r.account_id ?? null,
    card_id: r.card_id ?? null,
    frequencia: r.frequencia,
    dia: r.dia,
    inicio: r.inicio,
    fim: r.fim ?? null,
    valor_variavel: r.valor_variavel,
    ativa: r.ativa,
  });
  await gerarPrevistos(tx, uid, hoje, id);
  await auditar(tx, uid, "recorrencia.criada", "recurrence", id, origem, r.descricao);
  return paraResposta(await linhaDaRecorrencia(tx, uid, id), hoje);
}

/** Editar atualiza so os previstos futuros: apaga e gera de novo com a regra nova. */
export async function editarRecorrencia(
  tx: Tx,
  uid: string,
  id: string,
  e: EdicaoDeRecorrencia,
  hoje: string,
  origem?: Origem,
): Promise<Recorrencia> {
  const atual = await linhaDaRecorrencia(tx, uid, id);
  const tipo = e.tipo ?? atual.tipo;
  if (atual.card_id && tipo === "receita")
    throw new ErroDeFinancas(422, "No cartão, só despesa.");
  if (e.category_id !== undefined || e.tipo !== undefined)
    await validarCategoria(
      tx,
      uid,
      e.category_id === undefined ? atual.category_id : e.category_id,
      tipo,
    );
  const fim = e.fim === undefined ? atual.fim : e.fim;
  const inicio = e.inicio ?? atual.inicio;
  if (fim && fim < inicio) throw new ErroDeFinancas(422, "Fim antes do início.");
  const freq = e.frequencia ?? atual.frequencia;
  if (freq === "semanal" && (e.dia ?? atual.dia) > 7)
    throw new ErroDeFinancas(422, "Na semanal, dia de 1 (segunda) a 7.");
  const mudar = Object.fromEntries(
    Object.entries({ ...e, valor: e.valor ? moeda(d(e.valor)) : undefined }).filter(
      ([, v]) => v !== undefined,
    ),
  ) as Partial<typeof recurrences.$inferInsert>;
  if (Object.keys(mudar).length > 0)
    await tx
      .update(recurrences)
      .set(mudar)
      .where(and(eq(recurrences.user_id, uid), eq(recurrences.id, id)));
  await apagarPrevistosFuturos(tx, uid, id, hoje);
  await gerarPrevistos(tx, uid, hoje, id);
  await auditar(tx, uid, "recorrencia.editada", "recurrence", id, origem);
  return paraResposta(await linhaDaRecorrencia(tx, uid, id), hoje);
}

/** Apaga a regra e os previstos futuros; o que ja foi realizado fica. */
export async function apagarRecorrencia(
  tx: Tx,
  uid: string,
  id: string,
  hoje: string,
  origem?: Origem,
): Promise<void> {
  const atual = await linhaDaRecorrencia(tx, uid, id);
  await apagarPrevistosFuturos(tx, uid, id, hoje);
  await tx
    .delete(recurrences)
    .where(and(eq(recurrences.user_id, uid), eq(recurrences.id, id)));
  await auditar(
    tx,
    uid,
    "recorrencia.apagada",
    "recurrence",
    id,
    origem,
    atual.descricao,
  );
}
