import { z } from "zod";
import {
  AVISO_EDUCACIONAL,
  REGRAS,
  SUGESTOES_EDUCACIONAIS,
  SUGESTOES_PESSOAIS,
  VERSAO_DO_PROMPT,
} from "../prompts/sistema-v1.js";
import type { ModoDeRecomendacao } from "./aporte.js";

export { AVISO_EDUCACIONAL, VERSAO_DO_PROMPT };

/**
 * Contexto da tela, vindo do navegador. So campos com formato fechado: texto
 * livre aqui seria um atalho para injetar instrucao no system prompt.
 */
export const ContextoDaTela = z.object({
  rota: z
    .string()
    .max(200)
    .regex(/^\/[A-Za-z0-9/_-]*$/)
    .optional(),
  ticker: z
    .string()
    .regex(/^[A-Z0-9]{4,12}$/)
    .optional(),
  carteira_id: z.string().uuid().optional(),
  /** Comparador: tickers abertos. */
  comparando: z
    .array(z.string().regex(/^[A-Z0-9]{4,14}$/))
    .max(6)
    .optional(),
  /** Screener: faixas, tipos e preset, ja validados no BFF. */
  screener: z
    .object({
      preset: z.string().max(40).nullable(),
      tipos: z.array(z.string().max(10)).max(5),
      faixas: z.record(
        z.string().max(30),
        z.object({ min: z.number().optional(), max: z.number().optional() }),
      ),
    })
    .optional(),
});
export type ContextoDaTela = z.infer<typeof ContextoDaTela>;

export function montarSistema(o: {
  modo: ModoDeRecomendacao;
  contexto?: ContextoDaTela | undefined;
  hoje: string;
}): string {
  const partes = [
    REGRAS,
    o.modo === "educational" ? SUGESTOES_EDUCACIONAIS : SUGESTOES_PESSOAIS,
    `Hoje é ${o.hoje} (America/Sao_Paulo).`,
  ];
  if (o.contexto && Object.keys(o.contexto).length > 0)
    partes.push(`## Contexto da tela\n${JSON.stringify(o.contexto)}`);
  return partes.join("\n\n");
}
