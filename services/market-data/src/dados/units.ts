/**
 * Acoes que formam cada unit negociada na B3.
 *
 * Nem o COTAHIST nem a CVM publicam a composicao das units em arquivo; ela
 * esta nos estatutos e na pagina de cada emissor na B3. A lista e curta e
 * muda pouco, por isso fica aqui. Conferida em 23/11/2026 contra o preco das
 * acoes que compoem cada unit: o preco da unit fica a menos de 2% da soma
 * (KLBN11 16,51 contra 3,34 + 4 x 3,28 = 16,46).
 */
const ACOES_POR_UNIT: Record<string, number> = {
  ALUP11: 3, // 1 ON + 2 PN
  BPAC11: 3, // 1 ON + 2 PNA
  BRBI11: 3, // 1 ON + 2 PNA
  ENGI11: 5, // 1 ON + 4 PN
  IGTI11: 3, // 1 ON + 2 PN
  KLBN11: 5, // 1 ON + 4 PN
  SANB11: 2, // 1 ON + 1 PN
  SAPR11: 5, // 1 ON + 4 PN
  TAEE11: 3, // 1 ON + 2 PN
};

export function acoesPorUnit(ticker: string): number | null {
  return ACOES_POR_UNIT[ticker] ?? null;
}
