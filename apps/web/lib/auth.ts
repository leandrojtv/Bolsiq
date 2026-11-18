import "server-only";
import nodemailer from "nodemailer";
import { headers } from "next/headers";
import { nextCookies } from "better-auth/next-js";
import { emailDeConta } from "@bolsiq/alerts";
import { criarAuth, criarPoolDeAuth } from "@bolsiq/auth";
import { env } from "./env";

const transporte = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false,
});

async function enviar(
  para: string,
  m: { titulo: string; corpo: string; link: string; acao: string },
): Promise<void> {
  const e = await emailDeConta(m);
  await transporte.sendMail({
    from: env.SMTP_FROM,
    to: para,
    subject: e.assunto,
    html: e.html,
    text: e.texto,
  });
}

/** Better Auth do app (ADR 0010): sessao no schema `app` do mesmo Postgres. */
export const auth = criarAuth({
  pool: criarPoolDeAuth(env.DATABASE_URL),
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
      }
    : {}),
  limiteDeLogin: env.AUTH_RATE_LIMIT,
  enviarVerificacao: ({ email, nome, url }) =>
    enviar(email, {
      titulo: "Confirme seu e-mail",
      corpo: `Olá, ${nome}. Confirme o e-mail para entrar no Bolsiq.`,
      link: url,
      acao: "Confirmar e-mail",
    }),
  enviarRecuperacao: ({ email, nome, url }) =>
    enviar(email, {
      titulo: "Redefinir senha",
      corpo: `Olá, ${nome}. Recebemos um pedido para redefinir sua senha.`,
      link: url,
      acao: "Escolher nova senha",
    }),
  // Grava os cookies de sessao quando a acao roda em Server Action.
  plugins: [nextCookies()],
});

export const googleHabilitado = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export interface Usuario {
  id: string;
  nome: string;
  email: string;
}

/** Usuario logado da requisicao, ou null. */
export async function usuarioLogado(): Promise<Usuario | null> {
  const s = await auth.api.getSession({ headers: await headers() });
  return s ? { id: s.user.id, nome: s.user.name, email: s.user.email } : null;
}
