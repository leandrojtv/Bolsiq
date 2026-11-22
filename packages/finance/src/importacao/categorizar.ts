import { normalizarDeExtrato } from "./normalizar.js";

export const MODOS_DE_REGRA = ["contem", "comeca_com", "regex"] as const;
export type ModoDeRegra = (typeof MODOS_DE_REGRA)[number];
export const ORIGENS_DE_REGRA = ["usuario", "aprendida"] as const;
export type OrigemDeRegra = (typeof ORIGENS_DE_REGRA)[number];

export interface RegraParaAplicar {
  id: string;
  padrao: string;
  modo: ModoDeRegra;
  category_id: string;
  prioridade: number;
  origem: OrigemDeRegra;
}

/** Regex de usuario roda sobre texto curto; padrao longo e recusado no contrato. */
const TAMANHO_MAXIMO = 300;

export function regexValida(padrao: string): boolean {
  try {
    new RegExp(padrao, "i");
    return true;
  } catch {
    return false;
  }
}

/**
 * contem e comeca_com comparam o padrao normalizado com a descricao
 * normalizada: "Pag*Padaria São João" casa com "padaria sao joao". regex vale
 * sobre a descricao normalizada, sem diferenciar maiusculas.
 */
export function regraCasa(
  r: Pick<RegraParaAplicar, "padrao" | "modo">,
  descricao: string,
) {
  const alvo = descricao.slice(0, TAMANHO_MAXIMO);
  if (r.modo === "regex") {
    try {
      return new RegExp(r.padrao, "i").test(alvo);
    } catch {
      return false;
    }
  }
  const p = normalizarDeExtrato(r.padrao);
  if (!p) return false;
  return r.modo === "comeca_com" ? alvo.startsWith(p) : alvo.includes(p);
}

/**
 * Ordem: regra do usuario por prioridade (menor numero primeiro), depois regra
 * aprendida, que nunca passa na frente de uma do usuario.
 */
export function ordenarRegras<T extends RegraParaAplicar>(regras: T[]): T[] {
  const peso = (r: T) => (r.origem === "usuario" ? 0 : 1);
  return [...regras].sort(
    (a, b) =>
      peso(a) - peso(b) ||
      a.prioridade - b.prioridade ||
      a.padrao.localeCompare(b.padrao) ||
      a.id.localeCompare(b.id),
  );
}

/** banco: a categoria informada pelo banco no arquivo (CSV do C6). */
export type OrigemDaCategoria = "regra" | "historico" | "banco" | "nenhuma";

export interface Categorizacao {
  category_id: string | null;
  origem: OrigemDaCategoria;
  regra_id: string | null;
}

/**
 * 1. regras (ja ordenadas); 2. a mesma descricao normalizada ja categorizada
 * pelo usuario; 3. sem categoria. `natureza` filtra categoria incompativel
 * (receita x despesa).
 */
export function categorizar(
  descricaoNormalizada: string,
  natureza: "receita" | "despesa",
  regras: RegraParaAplicar[],
  historico: Map<string, string>,
  naturezaDe: (categoryId: string) => string | undefined,
): Categorizacao {
  for (const r of regras) {
    if (naturezaDe(r.category_id) !== natureza) continue;
    if (regraCasa(r, descricaoNormalizada))
      return { category_id: r.category_id, origem: "regra", regra_id: r.id };
  }
  const h = historico.get(`${natureza}|${descricaoNormalizada}`);
  if (h && naturezaDe(h) === natureza)
    return { category_id: h, origem: "historico", regra_id: null };
  return { category_id: null, origem: "nenhuma", regra_id: null };
}
