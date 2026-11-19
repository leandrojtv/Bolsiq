import type { Natureza, TipoDeCusto } from "./tipos.js";

export interface CategoriaPadrao {
  nome: string;
  natureza: Natureza;
  tipo_custo: TipoDeCusto;
  essencial: boolean;
  cor: string;
  icone: string;
  /** Insights dependem dela: nao se apaga nem troca de natureza. */
  sistema: boolean;
}

const c = (
  nome: string,
  natureza: Natureza,
  tipo_custo: TipoDeCusto,
  essencial: boolean,
  cor: string,
  icone: string,
  sistema = false,
): CategoriaPadrao => ({ nome, natureza, tipo_custo, essencial, cor, icone, sistema });

/** Semeadas por usuario no primeiro acesso ao Bolsiq Financas. */
export const CATEGORIAS_PADRAO: readonly CategoriaPadrao[] = [
  c("Moradia", "despesa", "fixo", true, "#5b8def", "house"),
  c("Contas da casa", "despesa", "fixo", true, "#4aa3c7", "plug"),
  c("Mercado", "despesa", "variavel", true, "#3fae7a", "shopping-cart"),
  c("Restaurantes e delivery", "despesa", "variavel", false, "#e08a3c", "utensils"),
  c("Transporte", "despesa", "variavel", true, "#8a7be0", "car"),
  c("Saúde", "despesa", "variavel", true, "#e05b6f", "heart-pulse"),
  c("Educação", "despesa", "fixo", true, "#3c8be0", "graduation-cap"),
  c("Lazer", "despesa", "variavel", false, "#d36bd1", "party-popper"),
  c("Assinaturas", "despesa", "fixo", false, "#7a8899", "repeat"),
  c("Compras", "despesa", "variavel", false, "#c7a23c", "shopping-bag"),
  c("Viagem", "despesa", "variavel", false, "#3cc7b8", "plane"),
  c("Pets", "despesa", "variavel", false, "#b07a4a", "paw-print"),
  c("Cuidados pessoais", "despesa", "variavel", false, "#e07ab0", "sparkles"),
  c("Presentes e doações", "despesa", "variavel", false, "#e0b03c", "gift"),
  c("Impostos", "despesa", "fixo", true, "#99665b", "landmark"),
  c("Tarifas bancárias", "despesa", "fixo", false, "#a05b5b", "receipt", true),
  c("Juros e encargos", "despesa", "variavel", false, "#c74a4a", "percent", true),
  c("IOF", "despesa", "variavel", false, "#b05b7a", "badge-percent", true),
  c("Investimentos (aporte)", "despesa", "variavel", false, "#4a7ac7", "piggy-bank"),
  c("Salário", "receita", "fixo", true, "#2f9e64", "wallet"),
  c("Renda extra", "receita", "variavel", false, "#5bb07a", "hand-coins"),
  c("Rendimentos", "receita", "variavel", false, "#3c9ec7", "trending-up"),
  c("Reembolsos", "receita", "variavel", false, "#7ab05b", "undo-2"),
  c("Outros", "despesa", "variavel", false, "#8899aa", "circle-ellipsis"),
];
