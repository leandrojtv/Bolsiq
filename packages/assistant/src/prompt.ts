import { z } from "zod";
import {
  AVISO_EDUCACIONAL,
  REGRAS,
  SUGESTOES_EDUCACIONAIS,
  SUGESTOES_PESSOAIS,
  VERSAO_DO_PROMPT,
} from "../prompts/sistema-v1.js";
import {
  PONTE_PAINEL,
  REGRAS_FINANCAS,
  VERSAO_DO_PROMPT_FINANCAS,
} from "../prompts/sistema-financas-v1.js";
import type { ModoDeRecomendacao } from "./aporte.js";

export { AVISO_EDUCACIONAL, VERSAO_DO_PROMPT, VERSAO_DO_PROMPT_FINANCAS };

/** Modulo da conversa: define o prompt e as ferramentas (ADR 0036). */
export const MODULOS_DO_ASSISTENTE = ["investimentos", "financas", "painel"] as const;
export type ModuloDoAssistente = (typeof MODULOS_DO_ASSISTENTE)[number];

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
  /** Telas do Bolsiq Financas com `?mes=`. */
  mes: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
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
  modulo?: ModuloDoAssistente | undefined;
}): string {
  const modulo = o.modulo ?? "investimentos";
  const sugestoes =
    o.modo === "educational" ? SUGESTOES_EDUCACIONAIS : SUGESTOES_PESSOAIS;
  const partes =
    modulo === "financas"
      ? [REGRAS_FINANCAS]
      : modulo === "painel"
        ? [REGRAS, sugestoes, REGRAS_FINANCAS, PONTE_PAINEL]
        : [REGRAS, sugestoes];
  partes.push(`Hoje é ${o.hoje} (America/Sao_Paulo).`);
  if (o.contexto && Object.keys(o.contexto).length > 0)
    partes.push(`## Contexto da tela\n${JSON.stringify(o.contexto)}`);
  return partes.join("\n\n");
}
