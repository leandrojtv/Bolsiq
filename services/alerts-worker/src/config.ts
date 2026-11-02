import { z } from "zod";

export const Env = z.object({
  DATABASE_URL: z.string().url(),
  NATS_URL: z.string().default("nats://localhost:4222"),
  PORT: z.coerce.number().int().positive().default(3002),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().default("nao-responda@bolsiq.local"),
  APP_URL: z.string().default("http://localhost:3000"),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:alertas@bolsiq.local"),
  FEATURE_TELEGRAM: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
});
export type Env = z.infer<typeof Env>;

export function carregarEnv(fonte: NodeJS.ProcessEnv = process.env): Env {
  const r = Env.safeParse(fonte);
  if (!r.success) {
    throw new Error(
      `configuracao invalida:\n${r.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`,
    );
  }
  return r.data;
}
