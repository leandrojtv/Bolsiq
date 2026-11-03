import "server-only";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { schema as alertas } from "@bolsiq/alerts";
import { schema as assistente } from "@bolsiq/assistant";
import { usuarios, watchlist } from "@bolsiq/auth";
import { comoUsuario, schema as portfolio } from "@bolsiq/portfolio";
import { banco } from "./analytics";

const TICKER = /^[A-Z0-9]{4,12}$/;
const limpar = (lista: string[]) =>
  [...new Set(lista.map((t) => t.trim().toUpperCase()))]
    .filter((t) => TICKER.test(t))
    .slice(0, 50);

export async function lerWatchlist(uid: string): Promise<string[]> {
  const linhas = await banco()
    .select({ ticker: watchlist.ticker })
    .from(watchlist)
    .where(eq(watchlist.user_id, uid))
    .orderBy(asc(watchlist.posicao));
  return linhas.map((l) => l.ticker);
}

export async function salvarWatchlist(uid: string, lista: string[]): Promise<string[]> {
  const tickers = limpar(lista);
  await banco().transaction(async (tx) => {
    await tx.delete(watchlist).where(eq(watchlist.user_id, uid));
    if (tickers.length)
      await tx
        .insert(watchlist)
        .values(tickers.map((ticker, posicao) => ({ user_id: uid, ticker, posicao })));
  });
  return tickers;
}

/**
 * Primeiro login no aparelho (ADR 0022): a watchlist do localStorage vira a
 * do banco se a conta ainda nao tem uma, e alertas, notificacoes,
 * preferencias e inscricoes de push do id provisorio passam para a conta.
 * Idempotente: rodar de novo nao duplica nada.
 */
export async function vincularAparelho(
  uid: string,
  provisorio: string | null,
  watchlistLocal: string[],
): Promise<string[]> {
  const db = banco();
  const atual = await lerWatchlist(uid);
  const lista = atual.length ? atual : await salvarWatchlist(uid, watchlistLocal);

  if (provisorio) {
    const { alertRules, notifications, deliveries, userPrefs, pushSubscriptions } =
      alertas;
    await db.transaction(async (tx) => {
      // atualizado_em: o alerts-worker recarrega a regra com o dono novo.
      await tx
        .update(alertRules)
        .set({ user_id: uid, atualizado_em: sql`now()` })
        .where(eq(alertRules.user_id, provisorio));
      await tx
        .update(notifications)
        .set({ user_id: uid })
        .where(eq(notifications.user_id, provisorio));
      await tx
        .update(deliveries)
        .set({ user_id: uid })
        .where(eq(deliveries.user_id, provisorio));
      // Preferencia da conta vence; a do aparelho so vale se a conta nao tem.
      await tx.execute(sql`
        update alerts.user_prefs set user_id = ${uid}
        where user_id = ${provisorio}
          and not exists (select 1 from alerts.user_prefs where user_id = ${uid})
      `);
      await tx.delete(userPrefs).where(eq(userPrefs.user_id, provisorio));
      await tx.execute(sql`
        insert into alerts.push_subscriptions (user_id, endpoint, p256dh, auth)
        select ${uid}, endpoint, p256dh, auth from alerts.push_subscriptions
        where user_id = ${provisorio}
        on conflict do nothing
      `);
      await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.user_id, provisorio));
    });
  }
  return lista;
}

/** Tudo o que o Bolsiq guarda sobre o usuario, em JSON (LGPD, art. 18). */
export async function exportarDados(uid: string) {
  const db = banco();
  const { alertRules, notifications, userPrefs, pushSubscriptions } = alertas;
  const [conta] = await db
    .select({
      id: usuarios.id,
      nome: usuarios.name,
      email: usuarios.email,
      email_verificado: usuarios.emailVerified,
      dois_fatores: usuarios.twoFactorEnabled,
      criada_em: usuarios.createdAt,
    })
    .from(usuarios)
    .where(eq(usuarios.id, uid));
  const carteira = await comoUsuario(db, uid, async (tx) => ({
    carteiras: await tx.select().from(portfolio.portfolios),
    transacoes: await tx.select().from(portfolio.transactions),
    importacoes: await tx.select().from(portfolio.imports),
    auditoria: await tx.select().from(portfolio.audit_log),
  }));
  const doAssistente = await comoUsuario(db, uid, async (tx) => {
    // A chave cifrada fica de fora: nao e dado que o usuario precise levar, e so
    // abre com a chave-mestra do servidor.
    const [config] = await tx
      .select({
        provedor: assistente.settings.provedor,
        modelo: assistente.settings.modelo,
        consentimento_em: assistente.settings.consentimento_em,
      })
      .from(assistente.settings);
    return {
      configuracao: config ?? null,
      perfil: await tx.select().from(assistente.investorProfiles),
      conversas: await tx.select().from(assistente.conversations),
      mensagens: await tx.select().from(assistente.messages),
      consumo: await tx.select().from(assistente.usage),
    };
  });
  return {
    gerado_em: new Date().toISOString(),
    conta: conta ?? null,
    watchlist: await lerWatchlist(uid),
    ...carteira,
    assistente: doAssistente,
    alertas: {
      regras: await db.select().from(alertRules).where(eq(alertRules.user_id, uid)),
      notificacoes: await db
        .select()
        .from(notifications)
        .where(eq(notifications.user_id, uid)),
      preferencias: await db.select().from(userPrefs).where(eq(userPrefs.user_id, uid)),
      push: (
        await db
          .select()
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.user_id, uid))
      ).map((p) => ({ endpoint: p.endpoint })),
    },
  };
}

/**
 * Exclusao da conta (LGPD, art. 18, VI). Apaga dados de carteira, alertas e
 * watchlist; a conta em si (sessoes, senha, 2FA) o Better Auth apaga depois.
 *
 * A auditoria e append-only para a aplicacao (REVOKE no papel bolsiq_app);
 * aqui ela sai pela conexao do dono das tabelas, fora do `comoUsuario`. E a
 * unica escrita no portfolio que nao passa pela RLS, e e de proposito: a
 * auditoria guarda IP e user agent, que sao dado pessoal (ADR 0022).
 */
export async function excluirDados(uid: string): Promise<void> {
  const db = banco();
  await comoUsuario(db, uid, async (tx) => {
    await tx.delete(portfolio.snapshots).where(eq(portfolio.snapshots.user_id, uid));
    await tx.delete(portfolio.imports).where(eq(portfolio.imports.user_id, uid));
    // transactions cai junto, pela FK com cascade.
    await tx.delete(portfolio.portfolios).where(eq(portfolio.portfolios.user_id, uid));
    // messages cai junto, pela FK com cascade.
    await tx
      .delete(assistente.conversations)
      .where(eq(assistente.conversations.user_id, uid));
    await tx
      .delete(assistente.investorProfiles)
      .where(eq(assistente.investorProfiles.user_id, uid));
    await tx.delete(assistente.settings).where(eq(assistente.settings.user_id, uid));
  });
  const { alertRules, notifications, deliveries, userPrefs, pushSubscriptions } = alertas;
  await db.transaction(async (tx) => {
    const ids = tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.user_id, uid));
    await tx.delete(deliveries).where(inArray(deliveries.notification_id, ids));
    await tx.delete(notifications).where(eq(notifications.user_id, uid));
    await tx.delete(alertRules).where(eq(alertRules.user_id, uid));
    await tx.delete(userPrefs).where(eq(userPrefs.user_id, uid));
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.user_id, uid));
    await tx.delete(watchlist).where(eq(watchlist.user_id, uid));
    await tx.delete(portfolio.audit_log).where(eq(portfolio.audit_log.user_id, uid));
    // Consumo e append-only para a aplicacao, como a auditoria: mesmo caminho.
    await tx.delete(assistente.usage).where(eq(assistente.usage.user_id, uid));
  });
}
