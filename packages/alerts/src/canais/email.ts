import nodemailer from "nodemailer";
import type { CanalDeEnvio } from "./canal.js";
import { templateDeEmail } from "./templates.js";

export interface ConfigDeEmail {
  host: string;
  port: number;
  from: string;
  urlBase: string;
}

/** E-mail por SMTP. Em desenvolvimento aponta para o Mailpit do compose. */
export function canalEmail(cfg: ConfigDeEmail): CanalDeEnvio {
  const transporte = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: false,
  });

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
