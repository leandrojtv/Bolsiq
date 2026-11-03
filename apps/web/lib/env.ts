import "server-only";
import { z } from "zod";

/**
 * Ambiente do servidor. Nenhuma variavel aqui tem prefixo NEXT_PUBLIC_: o Next
 * so embute no bundle do navegador o que tem esse prefixo, e o teste de bundle
 * (scripts/checar-bundle.mjs) confere que a chave nao aparece la.
 */
const vazioEhAusente = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().optional(),
);

const Env = z.object({
  /** Base do market-data. Com o gateway, aponta para o Kong (ADR 0007). */
  MARKET_DATA_URL: z.string().url().default("http://localhost:8000"),
  /** Chave interna do BFF. Opcional enquanto o gateway nao exige. */
  MARKET_DATA_API_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().optional(),
  ),
  /** Banco do app: o analytics e modulo do app (ADR 0009). */
  DATABASE_URL: z
    .string()
    .url()
    .default("postgres://bolsiq:bolsiq@localhost:5432/bolsiq"),
  /** NATS core: o sino assina alerts.inapp.<user_id>. */
  NATS_URL: z.string().default("nats://localhost:4222"),
  /** Chave publica VAPID. Sem ela o canal Push fica indisponivel na tela. */
  VAPID_PUBLIC_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().optional(),
  ),
  /** Telegram so aparece com a flag ligada (mesma do alerts-worker). */
  FEATURE_TELEGRAM: z.string().optional(),
  /** URL publica do app: base dos links de e-mail e do callback do Google. */
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** Assina sessao e token do Better Auth. Obrigatorio fora de desenvolvimento. */
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .default("segredo-de-desenvolvimento-nao-usar-em-producao"),
  GOOGLE_CLIENT_ID: vazioEhAusente,
  GOOGLE_CLIENT_SECRET: vazioEhAusente,
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().default("Bolsiq <nao-responda@bolsiq.local>"),
  /** Tentativas de login, cadastro e recuperacao por IP por minuto. */
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(10),
});

export const env = Env.parse(process.env);
