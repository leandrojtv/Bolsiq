import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { Pool } from "pg";

/**
 * Configuracao do Better Auth (ADR 0010), num lugar so: as tabelas do schema
 * `app` dependem dos plugins ligados aqui, e a migration foi gerada a partir
 * desta mesma funcao (`migrations/0000_auth.sql`).
 */
export interface OpcoesDeAuth {
  pool: Pool;
  baseURL: string;
  secret: string;
  google?: { clientId: string; clientSecret: string };
  enviarVerificacao: (u: { email: string; nome: string; url: string }) => Promise<void>;
  enviarRecuperacao: (u: { email: string; nome: string; url: string }) => Promise<void>;
  /** Tentativas de login e cadastro por IP por minuto. */
  limiteDeLogin: number;
  plugins?: BetterAuthPlugin[];
}

/** Pool do Better Auth: as tabelas sem schema caem no `app`. */
export function criarPoolDeAuth(url: string, max = 4): Pool {
  return new Pool({ connectionString: url, max, options: "-c search_path=app" });
}

export function criarAuth(o: OpcoesDeAuth) {
  return betterAuth({
    appName: "Bolsiq",
    baseURL: o.baseURL,
    secret: o.secret,
    database: o.pool,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        o.enviarRecuperacao({ email: user.email, nome: user.name, url }),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) =>
        o.enviarVerificacao({ email: user.email, nome: user.name, url }),
    },
    ...(o.google ? { socialProviders: { google: o.google } } : {}),
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // Sessao assinada no cookie por 1 min: o sino e cada rota do BFF leem a
      // sessao, e nao precisam ir ao banco toda vez. Revogacao leva ate 1 min.
      cookieCache: { enabled: true, maxAge: 60 },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: o.limiteDeLogin },
        "/sign-up/email": { window: 60, max: o.limiteDeLogin },
        "/request-password-reset": { window: 60, max: o.limiteDeLogin },
        "/two-factor/verify-totp": { window: 60, max: o.limiteDeLogin },
      },
    },
    plugins: [twoFactor({ issuer: "Bolsiq" }), ...(o.plugins ?? [])],
  });
}

export type Auth = ReturnType<typeof criarAuth>;
