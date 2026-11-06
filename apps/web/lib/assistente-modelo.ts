import { z } from "zod";
import {
  CLASSES,
  NOMES_DE_CLASSE,
  NOMES_DE_PROVEDOR,
  type ModeloClassificado,
} from "@bolsiq/assistant/puro";
import { estadoDaUrl, filtroDoEstado } from "./screener-url";

/** Formularios e contexto do assistente, sem banco: navegador e BFF. */

export const SalvarConfiguracao = z.object({
  provedor: z.enum(NOMES_DE_PROVEDOR),
  /** Ausente: mantem a chave ja salva, se o provedor nao mudou. */
  chave: z.string().trim().min(8, "chave curta demais").max(500).optional(),
  modelo: z.string().trim().min(1, "escolha um modelo").max(200),
  base_url: z.string().trim().max(300).optional(),
});
export type SalvarConfiguracao = z.infer<typeof SalvarConfiguracao>;

export const TestarConexao = z.object({
  provedor: z.enum(NOMES_DE_PROVEDOR),
  chave: z.string().trim().max(500).optional(),
  base_url: z.string().trim().max(300).optional(),
});
export type TestarConexao = z.infer<typeof TestarConexao>;

export const PedidoDeChat = z.object({
  conversa_id: z.string().uuid().optional(),
  texto: z.string().trim().min(1).max(4000),
  contexto: z.unknown().optional(),
});

export interface EstadoDoAssistente {
  provedor: string | null;
  modelo: string | null;
  /** So os 4 ultimos caracteres. A chave nunca volta ao navegador. */
  chave_final: string | null;
  base_url: string | null;
  url_ollama_padrao: string;
  status_modelo: ModeloClassificado["status"] | null;
  aviso_modelo: string | null;
  consentiu: boolean;
  configurado: boolean;
  plataforma: boolean;
  modo: "personal" | "educational";
  perfil_preenchido: boolean;
  limite_diario: number;
  usadas_hoje: number;
  consumo_mes: {
    tokens_entrada: number;
    tokens_saida: number;
    custo_estimado: string | null;
  };
}

export interface ResultadoDoTeste {
  ok: boolean;
  mensagem: string;
  modelos: ModeloClassificado[];
}

/** O que a tela aberta diz ao assistente. Formato fechado, validado no BFF. */
export function contextoDaTela(caminho: string, busca: string) {
  const p = new URLSearchParams(busca);
  const ctx: Record<string, unknown> = { rota: caminho };
  const ativo = /^\/ativo\/([A-Za-z0-9]{4,12})$/.exec(caminho)?.[1];
  if (ativo) ctx.ticker = ativo.toUpperCase();
  const carteira = /^\/carteiras\/([0-9a-f-]{36})$/.exec(caminho)?.[1];
  if (carteira) ctx.carteira_id = carteira;
  if (caminho === "/comparar" && p.get("t"))
    ctx.comparando = (p.get("t") ?? "").split(",").filter(Boolean).slice(0, 6);
  if (caminho === "/screener") {
    const e = estadoDaUrl(p);
    ctx.screener = { preset: e.preset, tipos: e.tipos, faixas: e.faixas };
  }
  return ctx;
}

/** Filtro salvo no perfil: a URL do screener, que ja e o estado inteiro. */
export function filtroDaUrlDoScreener(url: string) {
  const busca = url.includes("?") ? url.slice(url.indexOf("?") + 1) : url;
  return filtroDoEstado(estadoDaUrl(new URLSearchParams(busca)));
}

export const ROTULO_DA_CLASSE = Object.fromEntries(
  NOMES_DE_CLASSE.map((c) => [c, CLASSES[c].rotulo]),
) as Record<(typeof NOMES_DE_CLASSE)[number], string>;

/** Dolares por milhao de tokens, com casas de quem custa centavos. */
export function textoDoPreco(m: {
  preco_entrada: number | null;
  preco_saida: number | null;
}): string {
  if (m.preco_entrada === null || m.preco_saida === null) return "preço não informado";
  if (m.preco_entrada === 0 && m.preco_saida === 0) return "local, sem custo por token";
  return `US$ ${m.preco_entrada} / ${m.preco_saida} por milhão`;
}

/** Link interno que o texto do assistente pode abrir. Fora disto, vira texto. */
export function linkPermitido(href: string | undefined): boolean {
  return (
    !!href &&
    /^\/(ativo|comparar|carteiras|screener|alertas|configuracoes)(\/|\?|$)/.test(href) &&
    !href.startsWith("//")
  );
}

/** Tickers citados no texto viram link para o ativo, fora do que ja e link. */
export function comLinksDeTicker(texto: string): string {
  return texto.replace(
    /(\[[^\]]*\]\([^)]*\))|(?<![\w/[])([A-Z]{4}\d{1,2})(?![\w\]])/g,
    (m, link: string | undefined, ticker: string | undefined) =>
      link ? m : `[${ticker}](/ativo/${ticker})`,
  );
}
