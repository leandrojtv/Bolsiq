/**
 * Painel geral e alertas do Bolsiq Financas (ADR 0037):
 * - `finance.vigia`: de hora em hora, procura fatura vencendo, orcamento em 80%
 *   e 100%, mes projetado negativo e receita atrasada, e grava no outbox;
 * - `finance.patrimonio_mensal`: no dia 1, fotografa o patrimonio liquido do
 *   mes anterior em `finance.net_worth_snapshots`;
 * - publicador do outbox do finance no NATS (stream FINANCE).
 */
import type PgBoss from "pg-boss";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { tabelaDeOutbox, tabelasDeConsumidor, type Db } from "@bolsiq/db-core";
import {
  comoUsuario as comoUsuarioNoFinance,
  comporPatrimonio,
  gravarSnapshotDoPatrimonio,
  JOB_VIGIA,
  partesDoFinance,
  rotinaDoVigia,
} from "@bolsiq/finance";
import { mesAnteriorA, somarDias, somarMeses } from "@bolsiq/finance/puro";
import {
  iniciarLoopDePublicacao,
  type LoopDePublicacao,
  type Messaging,
} from "@bolsiq/messaging";
import {
  carteirasParaOPatrimonio,
  comoUsuario as comoUsuarioNoPortfolio,
  patrimonioDasCarteiras,
  tickersAbertos,
} from "@bolsiq/portfolio";
import type { Env } from "./config.js";
import type { BuscarPrecos } from "./recalculo.js";

export const JOB_PATRIMONIO = "finance.patrimonio_mensal";
const ROTINA_DO_PATRIMONIO = "finance.patrimonio_mensal.rotina";

type Log = (nivel: string, msg: string, ctx?: Record<string, unknown>) => void;

/** Ultimo dia do mes `YYYY-MM`. */
export const fimDoMes = (mes: string) => somarDias(somarMeses(`${mes}-01`, 1), -1);

/**
 * Fechamento de cada ticker no ultimo pregao ate `fim`. Ticker sem historico
 * fica de fora (a carteira mostra "sem cotacao", o painel tambem).
 */
export async function fechamentosAte(
  buscar: BuscarPrecos,
  tickers: string[],
  fim: string,
): Promise<Record<string, string>> {
  const precos: Record<string, string> = {};
  for (const t of tickers) {
    const candles = (await buscar(t, somarDias(fim, -10))).filter((c) => c.date <= fim);
    const ultimo = candles.at(-1);
    if (ultimo) precos[t] = ultimo.close;
  }
  return precos;
}

/**
 * Foto do mes `mes` para um usuario: o portfolio avalia as carteiras pelo
 * fechamento do ultimo pregao do mes e o finance soma contas, faturas e
 * dividas no ultimo dia. Idempotente pela chave (usuario, mes).
 */
export async function fotografarPatrimonio(
  db: NodePgDatabase<Record<string, unknown>>,
  buscar: BuscarPrecos,
  uid: string,
  mes: string,
): Promise<boolean> {
  const fim = fimDoMes(mes);
  const carteiras = await comoUsuarioNoPortfolio(db, uid, (tx) =>
    carteirasParaOPatrimonio(tx, uid),
  );
  const precos = await fechamentosAte(buscar, tickersAbertos(carteiras), fim);
  const p = patrimonioDasCarteiras(carteiras, precos);
  return comoUsuarioNoFinance(db, uid, async (tx) => {
    const f = await partesDoFinance(tx, uid, fim);
    const patrimonio = comporPatrimonio(f, {
      ...p,
      avaliadas_em: carteiras.length ? new Date().toISOString() : null,
    });
    return gravarSnapshotDoPatrimonio(tx, uid, mes, patrimonio);
  });
}

export async function iniciarPainel(
  boss: PgBoss,
  db: Db,
  env: Env,
  buscar: BuscarPrecos,
  messaging: Messaging,
  hoje: () => string,
  log: Log,
): Promise<LoopDePublicacao> {
  const banco = db as unknown as NodePgDatabase<Record<string, unknown>>;

  // Vigia: o web enfileira { user_id } depois de lancamento ou importacao; o
  // cron, sem usuario, olha todos.
  await boss.createQueue(JOB_VIGIA, { name: JOB_VIGIA, retryLimit: 2, retryDelay: 60 });
  await boss.schedule(JOB_VIGIA, env.FINANCE_VIGIA_CRON, undefined, {
    tz: "America/Sao_Paulo",
  });
  await boss.work<{ user_id?: string }>(JOB_VIGIA, async ([trabalho]) => {
    const r = await rotinaDoVigia(banco, hoje(), trabalho?.data?.user_id);
    log("info", "vigia do financas", { ...r });
    return r;
  });

  // Patrimonio: o cron do dia 1 enfileira um job por usuario.
  await boss.createQueue(JOB_PATRIMONIO, {
    name: JOB_PATRIMONIO,
    retryLimit: 3,
    retryDelay: 300,
  });
  await boss.createQueue(ROTINA_DO_PATRIMONIO, { name: ROTINA_DO_PATRIMONIO });
  await boss.schedule(ROTINA_DO_PATRIMONIO, env.NET_WORTH_SNAPSHOT_CRON, undefined, {
    tz: "America/Sao_Paulo",
  });
  await boss.work(ROTINA_DO_PATRIMONIO, async () => {
    const mes = mesAnteriorA(hoje());
    // Unica consulta que cruza usuarios: so os ids, como dono das tabelas.
    const r = await banco.execute<{ user_id: string }>(sql`
      select user_id from finance.accounts
      union
      select user_id from portfolio.portfolios where not arquivada`);
    for (const { user_id } of r.rows)
      await boss.send(
        JOB_PATRIMONIO,
        { user_id, mes },
        { singletonKey: `${user_id}:${mes}` },
      );
    log("info", "fotos do patrimonio enfileiradas", { mes, usuarios: r.rows.length });
    return { mes, usuarios: r.rows.length };
  });
  await boss.work<{ user_id: string; mes: string }>(
    JOB_PATRIMONIO,
    async ([trabalho]) => {
      if (!trabalho) return;
      const { user_id, mes } = trabalho.data;
      const gravada = await fotografarPatrimonio(banco, buscar, user_id, mes);
      log("info", "foto do patrimonio", { mes, gravada });
      return { gravada };
    },
  );

  // Outbox do finance -> stream FINANCE (o alerts-worker consome).
  return iniciarLoopDePublicacao({
    db,
    publicador: messaging,
    tabelas: {
      outbox: tabelaDeOutbox("finance"),
      deadLetter: tabelasDeConsumidor("finance").deadLetter,
    },
    aoFalhar: (erro) =>
      log("error", "falha ao publicar o outbox do finance", { erro: erro.message }),
  });
}
