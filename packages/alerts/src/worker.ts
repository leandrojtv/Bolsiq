import type { Db } from "@bolsiq/db-core";
import {
  STREAM_ANALYTICS,
  STREAM_MARKETDATA,
  type EventEnvelope,
} from "@bolsiq/contracts";
import { assinar, type Assinatura, type Messaging, type Tx } from "@bolsiq/messaging";
import { deadLetter, processedEvents } from "./db/schema.js";
import { IndiceDeRegras } from "./indice.js";
import {
  avaliarCotacao,
  avaliarDemonstrativo,
  avaliarIndicadores,
  avaliarProvento,
  type Resultado,
} from "./avaliador.js";
import {
  carregarRegras,
  processarEntregas,
  rearmar,
  registrarDisparos,
} from "./repositorio.js";
import type { Canal } from "./regras.js";
import type { CanalDeEnvio } from "./canais/canal.js";

export interface OpcoesDoWorker {
  db: Db;
  messaging: Messaging;
  canais: CanalDeEnvio[];
  intervaloEntregaMs?: number;
  intervaloRecargaMs?: number;
  log?: (
    nivel: "info" | "warn" | "error",
    msg: string,
    ctx?: Record<string, unknown>,
  ) => void;
}

export interface WorkerDeAlertas {
  indice: IndiceDeRegras;
  parar: () => Promise<void>;
}

/**
 * Worker de alertas: consome eventos, avalia regras, grava notificacoes e
 * entrega por canal.
 *
 * Avaliar e entregar sao dois passos de proposito. Avaliar acontece dentro da
 * transacao do consumidor, e e rapido; entregar fala com SMTP e push, e e
 * lento e falivel. Juntar os dois faria um e-mail lento segurar o ack da
 * cotacao e atrasar todos os alertas de preco atras dele.
 */
export async function iniciarWorkerDeAlertas(
  o: OpcoesDoWorker,
): Promise<WorkerDeAlertas> {
  // Padrao em stderr, nao no-op: um log mudo escondeu por completo uma
  // consulta de entrega que falhava em toda rodada.
  const log =
    o.log ??
    ((nivel, msg, ctx) => {
      process.stderr.write(
        `${JSON.stringify({ level: nivel, msg, ...ctx, svc: "alerts" })}\n`,
      );
    });
  const indice = new IndiceDeRegras();
  const ultimoPreco = new Map<string, string>();
  const canais = new Map<Canal, CanalDeEnvio>(o.canais.map((c) => [c.nome, c]));
  const tabelas = { processedEvents, deadLetter };

  let carregadoAte: string | null = null;
  const recarregar = async () => {
    const r = await carregarRegras(o.db, carregadoAte ?? undefined);
    for (const regra of r.regras) indice.inserir(regra);
    if (r.invalidas.length)
      log("warn", "regras invalidas ignoradas", { ids: r.invalidas });
    carregadoAte = r.ate;
  };
  await recarregar();
  log("info", "regras carregadas", { total: indice.tamanho });

  const aplicar = async (tx: Tx, evento: EventEnvelope, r: Resultado) => {
    const agora = new Date();
    await registrarDisparos(tx, r.disparos, evento.id, agora);
    await rearmar(tx, r.rearmar);
    // Reflete no indice em memoria o que foi gravado. Se a transacao fizer
    // rollback, a recarga periodica corrige em segundos; a duplicata e
    // impedida pelo indice unico no banco, nao por este estado.
    for (const d of r.disparos) {
      indice.inserir({
        ...d.regra,
        ultimo_disparo_em: agora.toISOString(),
        armado:
          d.regra.tipo === "preco_acima" || d.regra.tipo === "preco_abaixo"
            ? false
            : d.regra.armado,
      });
    }
    for (const id of r.rearmar) {
      const regra = indice.obter(id);
      if (regra) indice.inserir({ ...regra, armado: true });
    }
  };

  const manipular = async ({
    evento,
    payload,
    tx,
  }: {
    evento: EventEnvelope;
    payload: unknown;
    tx: Tx;
  }) => {
    const agora = new Date();
    const p = payload as Record<string, unknown>;

    switch (evento.name) {
      case "marketdata.quote.updated.v1": {
        const q = p as { ticker: string; price: string; change: string };
        ultimoPreco.set(q.ticker, q.price);
        await aplicar(
          tx,
          evento,
          avaliarCotacao(indice.candidatas(evento.name, q.ticker), q, agora),
        );
        break;
      }
      case "analytics.indicators.updated.v1": {
        const i = p as {
          ticker: string;
          preco_graham: string | null;
          preco_bazin: string | null;
          dy_12m: number | null;
        };
        await aplicar(
          tx,
          evento,
          avaliarIndicadores(
            indice.candidatas(evento.name, i.ticker),
            i,
            ultimoPreco.get(i.ticker),
            agora,
          ),
        );
        break;
      }
      case "marketdata.dividend.announced.v1": {
        const d = p as {
          ticker: string;
          kind: string;
          value_per_share: string | null;
          ex_date: string;
        };
        await aplicar(
          tx,
          evento,
          avaliarProvento(indice.candidatas(evento.name, d.ticker), d, agora),
        );
        break;
      }
      case "marketdata.statement.published.v1": {
        const s = p as { tickers: string[]; period_end: string; statement_kind: string };
        for (const t of s.tickers) {
          await aplicar(
            tx,
            evento,
            avaliarDemonstrativo(indice.candidatas(evento.name, t), t, s, agora),
          );
        }
        break;
      }
    }
  };

  // O `assinar` usa o mesmo callback para "evento repetido, ignorado", que e
  // funcionamento normal e chega com nivel debug: nao vira erro no log.
  const aoFalhar = (erro: Error, ctx: Record<string, unknown>) => {
    if (ctx.nivel === "debug") return;
    log("error", erro.message, ctx);
  };

  const assinaturas: Assinatura[] = [
    await assinar({
      messaging: o.messaging,
      db: o.db,
      consumidor: "alerts-marketdata",
      stream: STREAM_MARKETDATA,
      // So o que chega depois: alerta disparado por cotacao de ontem, ao
      // subir o worker pela primeira vez, seria ruido.
      desde: "novas",
      tabelas,
      manipular,
      aoFalhar,
    }),
    await assinar({
      messaging: o.messaging,
      db: o.db,
      consumidor: "alerts-analytics",
      stream: STREAM_ANALYTICS,
      desde: "novas",
      tabelas,
      manipular,
      aoFalhar,
    }),
  ];

  let entregando = Promise.resolve();
  const timerEntrega = setInterval(() => {
    entregando = entregando
      .then(async () => {
        await processarEntregas(o.db, canais, new Date());
      })
      .catch((e: unknown) =>
        log("error", "falha na rodada de entrega", { erro: String(e) }),
      );
  }, o.intervaloEntregaMs ?? 1000);

  let recarregando = Promise.resolve();
  const timerRecarga = setInterval(() => {
    recarregando = recarregando
      .then(recarregar)
      .catch((e: unknown) =>
        log("error", "falha ao recarregar regras", { erro: String(e) }),
      );
  }, o.intervaloRecargaMs ?? 2000);

  timerEntrega.unref();
  timerRecarga.unref();

  return {
    indice,
    parar: async () => {
      clearInterval(timerEntrega);
      clearInterval(timerRecarga);
      for (const a of assinaturas) await a.parar();
      await entregando;
      await recarregando;
    },
  };
}
