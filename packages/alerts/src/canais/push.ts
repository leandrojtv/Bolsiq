import type { CanalDeEnvio } from "./canal.js";

/** O minimo do `web-push` de que o canal precisa. Injetavel para teste. */
export interface EnviadorDePush {
  sendNotification: (
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
  ) => Promise<unknown>;
}

/**
 * Web Push (VAPID) para o PWA.
 *
 * Inscricao expirada responde 404 ou 410, e precisa ser apagada: senao cada
 * notificacao futura tenta de novo um endpoint morto. O canal devolve quais
 * remover e o worker apaga.
 */
export function canalPush(enviador: EnviadorDePush): CanalDeEnvio {
  return {
    nome: "push",
    externo: true,
    enviar: async (n, destino) => {
      const inscricoes = destino.push ?? [];
      if (inscricoes.length === 0) {
        return { ok: false, erro: "usuario sem inscricao de push", definitivo: true };
      }

      const payload = JSON.stringify({ title: n.titulo, body: n.corpo, id: n.id });
      const remover: string[] = [];
      let algumOk = false;
      let ultimoErro = "";

      for (const s of inscricoes) {
        try {
          await enviador.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          );
          algumOk = true;
        } catch (erro) {
          const status = (erro as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) remover.push(s.endpoint);
          ultimoErro = String(erro);
        }
      }

      if (algumOk)
        return remover.length ? { ok: true, remover_push: remover } : { ok: true };
      return {
        ok: false,
        erro: ultimoErro || "falha em todas as inscricoes",
        definitivo: remover.length === inscricoes.length,
        remover_push: remover,
      };
    },
  };
}
