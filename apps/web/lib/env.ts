import "server-only";
import { z } from "zod";

/**
 * Ambiente do servidor. Nenhuma variavel aqui tem prefixo NEXT_PUBLIC_: o Next
 * so embute no bundle do navegador o que tem esse prefixo, e o teste de bundle
 * (scripts/checar-bundle.mjs) confere que a chave nao aparece la.
 */
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
});

export const env = Env.parse(process.env);
