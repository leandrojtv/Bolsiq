import type { Canal as NomeDoCanal } from "../regras.js";

export interface NotificacaoParaEnvio {
  id: string;
  user_id: string;
  titulo: string;
  corpo: string;
  dados: unknown;
}

/** Destino resolvido para o usuario: e-mail, inscricoes de push, chat. */
export interface Destino {
  email?: string | null;
  push?: { endpoint: string; p256dh: string; auth: string }[];
  telegram_chat_id?: string | null;
}

export type ResultadoDeEnvio =
  | { ok: true }
  /** `definitivo`: nao adianta repetir (endereco invalido, inscricao expirada). */
  | { ok: false; erro: string; definitivo: boolean; remover_push?: string[] };

/**
 * Contrato de canal. Acrescentar um canal e implementar isto e registra-lo no
 * worker; o motor nao muda. Ver docs/services/alerts.md.
 */
export interface CanalDeEnvio {
  nome: NomeDoCanal;
  /** Canal externo respeita a janela de silencio; o in-app nao. */
  externo: boolean;
  enviar: (n: NotificacaoParaEnvio, destino: Destino) => Promise<ResultadoDeEnvio>;
}
