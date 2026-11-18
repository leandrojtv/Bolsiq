import type { CanalDeEnvio } from "./canal.js";

/** Subject por usuario no NATS core. O sino do app assina o do usuario logado. */
export function subjectInApp(userId: string): string {
  return `alerts.inapp.${userId}`;
}

/**
 * Canal in-app.
 *
 * A notificacao ja existe no banco quando este canal roda: a central de
 * notificacoes le de la. Este canal so empurra o aviso em tempo real para o
 * sino, por NATS core. Perder esse empurrao nao perde a notificacao -- o sino
 * recarrega o contador do banco ao abrir.
 */
export function canalInApp(
  publicar: (subject: string, dados: Uint8Array) => void,
): CanalDeEnvio {
  return {
    nome: "inapp",
    externo: false,
    enviar: (n) => {
      publicar(
        subjectInApp(n.user_id),
        new TextEncoder().encode(
          JSON.stringify({ id: n.id, titulo: n.titulo, corpo: n.corpo }),
        ),
      );
      return Promise.resolve({ ok: true });
    },
  };
}
