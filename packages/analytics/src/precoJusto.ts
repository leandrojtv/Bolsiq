import { d, dividir, paraMoeda, paraNumero } from "./decimal.js";

/** Constante da formula de Graham: 22,5 = P/L 15 x P/VP 1,5. */
export const CONSTANTE_GRAHAM = 22.5;

/** Yield exigido no preco-teto de Bazin. */
export const TAXA_BAZIN_PADRAO = 0.06;

export interface PrecoJusto {
  valor: string | null;
  /** (preco justo - preco) / preco justo. Positiva significa desconto. */
  margem_seguranca: number | null;
}

/**
 * Preco justo de Graham: sqrt(22,5 x LPA x VPA).
 *
 * Devolve null quando LPA ou VPA nao sao positivos. A raiz de produto negativo
 * nao existe nos reais, e o resultado nao teria significado: empresa com
 * prejuizo ou patrimonio negativo esta fora do escopo da formula, nao com
 * preco justo baixo.
 */
export function graham(
  lpa: string | null,
  vpa: string | null,
  precoAtual: string,
): PrecoJusto {
  if (lpa === null || vpa === null) return { valor: null, margem_seguranca: null };

  const l = d(lpa);
  const v = d(vpa);
  if (l.lte(0) || v.lte(0)) return { valor: null, margem_seguranca: null };

  const justo = d(CONSTANTE_GRAHAM).times(l).times(v).sqrt();
  return {
    valor: paraMoeda(justo),
    margem_seguranca: paraNumero(dividir(justo.minus(d(precoAtual)), justo)),
  };
}

/**
 * Preco-teto de Bazin: dividendo medio anual / taxa exigida.
 *
 * Usa a media dos ultimos `anos` anos de proventos, nao o ultimo ano: o metodo
 * existe para achar empresa com dividendo consistente, e um ano excepcional
 * elevaria o teto justamente onde ele deveria ser conservador.
 */
export function bazin(
  proventosPorAno: string[],
  precoAtual: string,
  taxa = TAXA_BAZIN_PADRAO,
  anos = 5,
): PrecoJusto {
  if (proventosPorAno.length === 0 || taxa <= 0) {
    return { valor: null, margem_seguranca: null };
  }

  const ultimos = proventosPorAno.slice(-anos);
  const media = ultimos.reduce((acc, p) => acc.plus(d(p)), d(0)).div(ultimos.length);
  if (media.lte(0)) return { valor: null, margem_seguranca: null };

  const teto = media.div(taxa);
  return {
    valor: paraMoeda(teto),
    margem_seguranca: paraNumero(dividir(teto.minus(d(precoAtual)), teto)),
  };
}
