import nodemailer from "nodemailer";
import type { CanalDeEnvio } from "./canal.js";
import { templateDeEmail } from "./templates.js";

export interface ConfigDeSmtp {
  host: string;
  port: number;
  user?: string | undefined;
  password?: string | undefined;
}

export interface ConfigDeEmail extends ConfigDeSmtp {
  from: string;
  urlBase: string;
}

/**
 * Opcoes do nodemailer. Sem usuario, envia sem autenticacao (Mailpit). A 465 e
 * TLS implicito; nas outras (587) o nodemailer negocia STARTTLS.
 */
export function opcoesSmtp(cfg: ConfigDeSmtp) {
  return {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.password ?? "" } } : {}),
  };
}

/** E-mail por SMTP. Em desenvolvimento aponta para o Mailpit do compose. */
export function canalEmail(cfg: ConfigDeEmail): CanalDeEnvio {
  const transporte = nodemailer.createTransport(opcoesSmtp(cfg));

  return {
    nome: "email",
    externo: true,
    enviar: async (n, destino) => {
      if (!destino.email) {
        return { ok: false, erro: "usuario sem e-mail", definitivo: true };
      }
      const t = await templateDeEmail(n, cfg.urlBase);
      try {
        await transporte.sendMail({
          from: cfg.from,
          to: destino.email,
          subject: t.assunto,
          text: t.texto,
          html: t.html,
        });
        return { ok: true };
      } catch (erro) {
        return { ok: false, erro: String(erro), definitivo: false };
      }
    },
  };
}
