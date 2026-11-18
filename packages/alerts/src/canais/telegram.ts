import type { CanalDeEnvio } from "./canal.js";

/**
 * Telegram, atras de feature flag (`FEATURE_TELEGRAM`). So e registrado no
 * worker quando a flag esta ligada e ha token de bot.
 */
export function canalTelegram(token: string, buscar: typeof fetch = fetch): CanalDeEnvio {
  return {
    nome: "telegram",
    externo: true,
    enviar: async (n, destino) => {
      if (!destino.telegram_chat_id) {
        return { ok: false, erro: "usuario sem chat do Telegram", definitivo: true };
      }
      const r = await buscar(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: destino.telegram_chat_id,
          text: `${n.titulo}\n\n${n.corpo}`,
        }),
      });
      if (r.ok) return { ok: true };
      // 4xx e definitivo (chat bloqueou o bot, id errado); 5xx vale repetir.
      return { ok: false, erro: `telegram ${r.status}`, definitivo: r.status < 500 };
    },
  };
}

export function telegramHabilitado(env: Record<string, string | undefined>): boolean {
  return env.FEATURE_TELEGRAM === "true" && Boolean(env.TELEGRAM_BOT_TOKEN);
}
