import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { EdicaoDeMeta, Meta, NovaMeta } from "../contratos-parcelamento.js";
import { d, moeda } from "../decimal.js";
import {
  auditar,
  ErroDeFinancas,
  exigirConta,
  saldoDaConta,
  type Origem,
  type Tx,
} from "./operacoes.js";
import { goals } from "./schema.js";

/**
 * Valor de uma carteira do Bolsiq. O finance nao le o schema `portfolio`
 * (ADR 0031): quem chama (o web) passa a funcao, que compoe pelo modulo dono.
 */
export type ValorDaCarteira = (portfolioId: string) => Promise<string | null>;

type LinhaDaMeta = typeof goals.$inferSelect;

const mesesEntre = (de: string, ate: string) =>
  (Number(ate.slice(0, 4)) - Number(de.slice(0, 4))) * 12 +
  Number(ate.slice(5, 7)) -
  Number(de.slice(5, 7));

async function comProgresso(
  tx: Tx,
  uid: string,
  m: LinhaDaMeta,
  hoje: string,
  carteira?: ValorDaCarteira,
): Promise<Meta> {
  let fonte: Meta["fonte"] = "manual";
  let atual = d(m.valor_guardado);
  if (m.account_id) {
    fonte = "conta";
    atual = d(await saldoDaConta(tx, uid, m.account_id, hoje));
  } else if (m.portfolio_id && carteira) {
    const v = await carteira(m.portfolio_id);
    if (v !== null) {
      fonte = "carteira";
      atual = d(v);
    }
  }
  if (atual.lt(0)) atual = d(0);
  const falta = d(m.valor_alvo).minus(atual);
  // Meses ate o mes da data alvo; no minimo um (meta para este mes).
  const meses = Math.max(1, mesesEntre(hoje, m.data_alvo));
  return {
    id: m.id,
    nome: m.nome,
    valor_alvo: m.valor_alvo,
    data_alvo: m.data_alvo,
    account_id: m.account_id,
    portfolio_id: m.portfolio_id,
    valor_guardado: m.valor_guardado,
    ativa: m.ativa,
    fonte,
    valor_atual: moeda(atual),
    progresso: Math.min(100, Number(atual.div(m.valor_alvo).times(100).toFixed(1))),
    meses_restantes: Math.max(0, mesesEntre(hoje, m.data_alvo)),
    valor_mensal_necessario: falta.lte(0)
      ? "0.00"
      : moeda(falta.div(meses).toDecimalPlaces(2, 0)),
  };
}

async function linhaDaMeta(tx: Tx, uid: string, id: string) {
  const [m] = await tx
    .select()
    .from(goals)
    .where(and(eq(goals.user_id, uid), eq(goals.id, id)));
  if (!m) throw new ErroDeFinancas(404, "Meta não encontrada.");
  return m;
}

export async function listarMetas(
  tx: Tx,
  uid: string,
  hoje: string,
  carteira?: ValorDaCarteira,
): Promise<Meta[]> {
  const linhas = await tx
    .select()
    .from(goals)
    .where(eq(goals.user_id, uid))
    .orderBy(asc(goals.data_alvo));
  return Promise.all(linhas.map((m) => comProgresso(tx, uid, m, hoje, carteira)));
}

export async function criarMeta(
  tx: Tx,
  uid: string,
  m: NovaMeta,
  hoje: string,
  carteira?: ValorDaCarteira,
  origem?: Origem,
): Promise<Meta> {
  if (m.account_id) await exigirConta(tx, uid, m.account_id);
  const id = randomUUID();
  await tx.insert(goals).values({
    id,
    user_id: uid,
    nome: m.nome,
    valor_alvo: moeda(d(m.valor_alvo)),
    data_alvo: m.data_alvo,
    account_id: m.account_id ?? null,
    portfolio_id: m.portfolio_id ?? null,
    valor_guardado: moeda(d(m.valor_guardado ?? "0")),
    ativa: m.ativa,
  });
  await auditar(tx, uid, "meta.criada", "goal", id, origem, m.nome);
  return comProgresso(tx, uid, await linhaDaMeta(tx, uid, id), hoje, carteira);
}

export async function editarMeta(
  tx: Tx,
  uid: string,
  id: string,
  e: EdicaoDeMeta,
  hoje: string,
  carteira?: ValorDaCarteira,
  origem?: Origem,
): Promise<Meta> {
  await linhaDaMeta(tx, uid, id);
  if (e.account_id) await exigirConta(tx, uid, e.account_id);
  const mudar = Object.fromEntries(
    Object.entries({
      ...e,
      valor_alvo: e.valor_alvo ? moeda(d(e.valor_alvo)) : undefined,
      valor_guardado: e.valor_guardado ? moeda(d(e.valor_guardado)) : undefined,
    }).filter(([, v]) => v !== undefined),
  ) as Partial<typeof goals.$inferInsert>;
  if (Object.keys(mudar).length)
    await tx
      .update(goals)
      .set(mudar)
      .where(and(eq(goals.user_id, uid), eq(goals.id, id)));
  await auditar(tx, uid, "meta.editada", "goal", id, origem);
  return comProgresso(tx, uid, await linhaDaMeta(tx, uid, id), hoje, carteira);
}

export async function apagarMeta(tx: Tx, uid: string, id: string, origem?: Origem) {
  await linhaDaMeta(tx, uid, id);
  await tx.delete(goals).where(and(eq(goals.user_id, uid), eq(goals.id, id)));
  await auditar(tx, uid, "meta.apagada", "goal", id, origem);
}
