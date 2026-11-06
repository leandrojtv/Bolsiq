import lista from "../homologacao/modelos.json" with { type: "json" };

/** Provedores da camada unica. Sem nada de servidor: o navegador usa os rotulos. */
export const PROVEDORES = {
  anthropic: { rotulo: "Anthropic", exigeChave: true, url: false },
  openai: { rotulo: "OpenAI", exigeChave: true, url: false },
  google: { rotulo: "Google", exigeChave: true, url: false },
  deepseek: { rotulo: "DeepSeek", exigeChave: true, url: false },
  openrouter: { rotulo: "OpenRouter", exigeChave: true, url: false },
  ollama: { rotulo: "Ollama (local)", exigeChave: false, url: true },
} as const;
export type Provedor = keyof typeof PROVEDORES;
export const NOMES_DE_PROVEDOR = Object.keys(PROVEDORES) as [Provedor, ...Provedor[]];

/** Modelo como o provedor lista, com preco em dolares por milhao de tokens. */
export interface ModeloListado {
  id: string;
  nome: string;
  preco_entrada: number | null;
  preco_saida: number | null;
  /** `false`: o provedor diz que nao ha chamada de ferramentas. `null`: nao informa. */
  ferramentas: boolean | null;
}

export type StatusDoModelo = "homologado" | "experimental" | "bloqueado";

export interface ModeloClassificado extends ModeloListado {
  status: StatusDoModelo;
  aviso: string | null;
}

interface Registro {
  provedor: string;
  modelo: string;
  status: string;
  preco_entrada: number | null;
  preco_saida: number | null;
  avaliacao?: string;
}

const REGISTROS = lista.modelos as Registro[];

export function registroDoModelo(
  provedor: Provedor,
  modelo: string,
): Registro | undefined {
  return REGISTROS.find((r) => r.provedor === provedor && r.modelo === modelo);
}

export const AVISO_EXPERIMENTAL =
  "Modelo experimental: ainda não passou pela avaliação do Bolsiq. As respostas podem errar números ou ferramentas.";
export const AVISO_BLOQUEADO =
  "Modelo sem chamada de ferramentas: o assistente depende delas para consultar os dados.";

/**
 * Homologado so com resultado de `make eval-assistente` na lista versionada.
 * Fora da lista e experimental; sem ferramentas, bloqueado.
 */
export function classificarModelo(
  provedor: Provedor,
  m: ModeloListado,
): ModeloClassificado {
  const r = registroDoModelo(provedor, m.id);
  const comPreco = {
    ...m,
    preco_entrada: m.preco_entrada ?? r?.preco_entrada ?? null,
    preco_saida: m.preco_saida ?? r?.preco_saida ?? null,
  };
  if (m.ferramentas === false || r?.status === "sem_ferramentas")
    return { ...comPreco, status: "bloqueado", aviso: AVISO_BLOQUEADO };
  if (r?.status === "homologado")
    return { ...comPreco, status: "homologado", aviso: null };
  return { ...comPreco, status: "experimental", aviso: AVISO_EXPERIMENTAL };
}
