/**
 * Relatorio mensal do Bolsiq Financas (ADR 0036). No dia 1, o cron enfileira um
 * job por usuario com o relatorio ligado; cada job escreve o resumo do mes
 * anterior com a chave do usuario e avisa no sino.
 */
import type PgBoss from "pg-boss";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { avisarNoSino } from "@bolsiq/alerts";
import {
  lerChaveMestra,
  mensagemSegura,
  relatorioDoUsuario,
  usuariosDoRelatorio,
} from "@bolsiq/assistant";
import type { Db } from "@bolsiq/db-core";
import { somarMeses } from "@bolsiq/finance/puro";
import type { Env } from "./config.js";

export const FILA_DO_RELATORIO = "assistant.relatorio_mensal";
const ROTINA = "assistant.relatorio_mensal.rotina";
const ORIGEM = "assistente.relatorio_mensal";

/** Mes anterior ao de `hoje` (AAAA-MM). */
export const mesAnterior = (hoje: string) =>
  somarMeses(`${hoje.slice(0, 7)}-01`, -1).slice(0, 7);

export async function iniciarRelatorio(
  boss: PgBoss,
  db: Db,
  env: Env,
  hoje: () => string,
  log: (nivel: string, msg: string, ctx?: Record<string, unknown>) => void,
): Promise<void> {
  let mestra: Buffer | null = null;
  try {
    mestra = lerChaveMestra(env.ASSISTANT_MASTER_KEY);
  } catch {
    // Sem chave-mestra, so quem usa Ollama recebe o relatorio.
  }
  const banco = db as unknown as NodePgDatabase<Record<string, unknown>>;

  await boss.createQueue(FILA_DO_RELATORIO, {
    name: FILA_DO_RELATORIO,
    // Uma nova tentativa so: cada uma gasta tokens do usuario.
    retryLimit: 1,
    retryDelay: 600,
  });
  await boss.createQueue(ROTINA, { name: ROTINA });
  await boss.schedule(ROTINA, env.ASSISTANT_REPORT_CRON, undefined, {
    tz: "America/Sao_Paulo",
  });

  await boss.work(ROTINA, async () => {
    const mes = mesAnterior(hoje());
    const usuarios = await usuariosDoRelatorio(banco, mes);
    for (const user_id of usuarios)
      await boss.send(
        FILA_DO_RELATORIO,
        { user_id, mes },
        { singletonKey: `${user_id}:${mes}` },
      );
    log("info", "relatorio mensal enfileirado", { mes, usuarios: usuarios.length });
    return { mes, usuarios: usuarios.length };
  });

  await boss.work<{ user_id: string; mes: string }>(
    FILA_DO_RELATORIO,
    { batchSize: 1 },
    async ([trabalho]) => {
      if (!trabalho) return;
      const { user_id, mes } = trabalho.data;
      try {
        const r = await relatorioDoUsuario(banco, user_id, {
          mes,
          hoje: hoje(),
          credencial: {
            mestra,
            ollama_url: env.ASSISTANT_OLLAMA_URL,
            ollama_hosts: env.ASSISTANT_OLLAMA_HOSTS.split(",")
              .map((h) => h.trim())
              .filter(Boolean),
            deepseek_url: env.ASSISTANT_DEEPSEEK_URL ?? null,
          },
          avisar: async (a) => {
            await avisarNoSino(db, { ...a, origem: ORIGEM });
          },
        });
        log("info", "relatorio mensal", { mes, ...r });
        return r;
      } catch (erro) {
        log("warn", "relatorio mensal falhou", { mes, erro: mensagemSegura(erro) });
        throw new Error("relatorio mensal falhou");
      }
    },
  );
}
