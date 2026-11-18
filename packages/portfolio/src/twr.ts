import { d, dividir, numero } from "./decimal.js";

export interface DiaDaCarteira {
  data: string;
  /** Valor da carteira no fim do dia. */
  valor: string;
  /** Fluxo de caixa liquido do dia: aporte positivo, retirada negativa. */
  fluxo_caixa: string;
}

export interface PontoDeTwr {
  data: string;
  retorno_diario: number | null;
  base_100: number;
}

/**
 * Rentabilidade pelo metodo time-weighted, diaria.
 *
 * $$r_t = \frac{V_t}{V_{t-1} + CF_t} - 1 \qquad \text{TWR} = \prod (1 + r_t) - 1$$
 *
 * O TWR existe para medir a decisao de alocacao, nao o tamanho do aporte: ele
 * neutraliza fluxo de caixa. Quem quiser medir o resultado em reais do
 * investidor usa resultado realizado e nao realizado, que ja estao em
 * `apurar`.
 *
 * **Convencao: aporte no inicio do dia, retirada no fim.** O aporte do dia
 * entra no denominador, ou seja, o capital aportado ja participa do retorno
 * daquele dia; o `saldo_inicial` de uma carga de posicao e aporte como a compra
 * (`fluxoDaTransacao`). A retirada (venda, provento) sai no fim do dia e volta ao
 * numerador: com a retirada no inicio, vender a carteira inteira daria
 * `0 / (V - venda) - 1`, um retorno de -100% ou sem sentido no dia da venda.
 *
 * $$r_t = \frac{V_t + S_t}{V_{t-1} + A_t} - 1$$
 *
 * com $A_t$ o fluxo liquido positivo e $S_t$ o negativo, em modulo.
 *
 * O primeiro dia nao tem retorno: nao existe $V_{t-1}$. Devolve `null` em vez
 * de zero, porque zero significaria "nao rendeu".
 */
export function twrDiario(dias: DiaDaCarteira[]): PontoDeTwr[] {
  const pontos: PontoDeTwr[] = [];
  let base = d(100);

  for (let i = 0; i < dias.length; i++) {
    const hoje = dias[i];
    if (!hoje) continue;

    if (i === 0) {
      pontos.push({ data: hoje.data, retorno_diario: null, base_100: 100 });
      continue;
    }

    const anterior = dias[i - 1];
    const fluxo = d(hoje.fluxo_caixa);
    const aporte = fluxo.gt(0) ? fluxo : d(0);
    const saida = fluxo.lt(0) ? fluxo.neg() : d(0);
    const denominador = d(anterior?.valor ?? "0").plus(aporte);
    const r = dividir(d(hoje.valor).plus(saida), denominador);

    if (r === null) {
      // Carteira comecou o dia em zero: nao ha capital a render.
      pontos.push({
        data: hoje.data,
        retorno_diario: null,
        base_100: numero(base, 6) ?? 100,
      });
      continue;
    }

    const retorno = r.minus(1);
    base = base.times(retorno.plus(1));

    pontos.push({
      data: hoje.data,
      retorno_diario: numero(retorno, 10),
      base_100: numero(base, 6) ?? 100,
    });
  }

  return pontos;
}

/** TWR acumulado da serie. */
export function twrAcumulado(pontos: PontoDeTwr[]): number | null {
  const comRetorno = pontos.filter((p) => p.retorno_diario !== null);
  if (comRetorno.length === 0) return null;

  let acc = d(1);
  for (const p of comRetorno) acc = acc.times(d(1).plus(d(p.retorno_diario ?? 0)));
  return numero(acc.minus(1), 8);
}

/**
 * Compara a serie da carteira com um benchmark, na mesma base 100.
 *
 * O benchmark recebe os mesmos dias, nao os mesmos fluxos: e exatamente o
 * ponto do TWR. Comparar com um benchmark que sofresse os aportes mediria
 * outra coisa.
 */
export function compararComBenchmark(
  pontos: PontoDeTwr[],
  retornosBenchmark: number[],
): { data: string; carteira: number; benchmark: number }[] {
  let base = d(100);
  return pontos.map((p, i) => {
    if (i > 0) base = base.times(d(1).plus(d(retornosBenchmark[i] ?? 0)));
    return {
      data: p.data,
      carteira: p.base_100,
      benchmark: numero(base, 6) ?? 100,
    };
  });
}
