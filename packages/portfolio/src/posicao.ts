import type { Decimal } from "decimal.js";
import { d, dividir, moeda, numero, qtd } from "./decimal.js";
import type { Transacao } from "./tipos.js";

export interface Posicao {
  ticker: string;
  quantidade: string;
  preco_medio: string;
  custo_total: string;
  /** Resultado realizado acumulado nas vendas deste ativo. */
  resultado_realizado: string;
  proventos_recebidos: string;
}

export interface ResultadoDeApuracao {
  posicoes: Posicao[];
  /** Soma dos resultados realizados, todas as vendas. */
  resultado_realizado_total: string;
  proventos_total: string;
  taxas_total: string;
}

interface Acumulador {
  quantidade: Decimal;
  custo: Decimal;
  realizado: Decimal;
  proventos: Decimal;
}

/**
 * Apura posicao, preco medio e resultado realizado a partir das transacoes.
 *
 * Regras do mercado brasileiro que mudam o numero:
 *
 * - **Taxa de compra entra no custo.** O custo de aquisicao inclui corretagem
 *   e emolumentos, entao a taxa sobe o preco medio.
 * - **Saldo inicial** e aporte na data do extrato: entra no custo como compra.
 * - **Venda nao altera o preco medio.** Ela realiza resultado contra o preco
 *   medio vigente e reduz a quantidade. Recalcular a media na venda e o erro
 *   mais comum, e produz resultado realizado errado em toda venda parcial
 *   seguinte.
 * - **Taxa de venda reduz o resultado**, nao o custo da posicao remanescente.
 * - **Desdobramento e grupamento** multiplicam a quantidade e dividem o preco
 *   medio pelo mesmo fator: o custo total nao muda, porque nao houve
 *   desembolso.
 * - **Provento** nao mexe em quantidade nem em preco medio; e caixa.
 *
 * As transacoes sao ordenadas por data antes da apuracao: a ordem altera o
 * resultado realizado, e confiar na ordem de insercao seria um bug silencioso.
 */
export function apurar(transacoes: Transacao[]): ResultadoDeApuracao {
  const porTicker = new Map<string, Acumulador>();
  let taxas = d(0);

  const ordenadas = [...transacoes].sort((a, b) =>
    a.data === b.data ? a.id.localeCompare(b.id) : a.data.localeCompare(b.data),
  );

  for (const t of ordenadas) {
    const acc = porTicker.get(t.ticker) ?? {
      quantidade: d(0),
      custo: d(0),
      realizado: d(0),
      proventos: d(0),
    };

    const q = d(t.quantidade);
    const p = d(t.preco);
    const tx = d(t.taxas);
    taxas = taxas.plus(tx);

    switch (t.tipo) {
      case "compra":
      case "saldo_inicial":
      case "bonificacao": {
        acc.quantidade = acc.quantidade.plus(q);
        acc.custo = acc.custo.plus(q.times(p)).plus(tx);
        break;
      }
      case "venda": {
        const medio = dividir(acc.custo, acc.quantidade) ?? d(0);
        acc.realizado = acc.realizado.plus(q.times(p.minus(medio))).minus(tx);
        acc.quantidade = acc.quantidade.minus(q);
        // Custo cai proporcionalmente, preservando o preco medio.
        acc.custo = acc.quantidade.times(medio);
        break;
      }
      case "provento": {
        acc.proventos = acc.proventos.plus(q.times(p)).minus(tx);
        break;
      }
      case "desdobramento": {
        // `quantidade` carrega o fator: 1:2 vem como "2".
        acc.quantidade = acc.quantidade.times(q);
        break;
      }
      case "grupamento": {
        const fator = dividir(d(1), q);
        if (fator) acc.quantidade = acc.quantidade.times(fator);
        break;
      }
    }

    porTicker.set(t.ticker, acc);
  }

  const posicoes: Posicao[] = [];
  let realizadoTotal = d(0);
  let proventosTotal = d(0);

  for (const [ticker, acc] of [...porTicker.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    realizadoTotal = realizadoTotal.plus(acc.realizado);
    proventosTotal = proventosTotal.plus(acc.proventos);

    posicoes.push({
      ticker,
      quantidade: qtd(acc.quantidade),
      preco_medio: moeda(dividir(acc.custo, acc.quantidade) ?? d(0), 6),
      custo_total: moeda(acc.custo),
      resultado_realizado: moeda(acc.realizado),
      proventos_recebidos: moeda(acc.proventos),
    });
  }

  return {
    posicoes,
    resultado_realizado_total: moeda(realizadoTotal),
    proventos_total: moeda(proventosTotal),
    taxas_total: moeda(taxas),
  };
}

export interface PosicaoAvaliada extends Posicao {
  preco_atual: string | null;
  valor_de_mercado: string | null;
  resultado_nao_realizado: string | null;
  rentabilidade: number | null;
}

/** Avalia as posicoes a preco de mercado. */
export function avaliar(
  posicoes: Posicao[],
  precos: Record<string, string>,
): PosicaoAvaliada[] {
  return posicoes.map((pos) => {
    const preco = precos[pos.ticker];
    if (preco === undefined) {
      return {
        ...pos,
        preco_atual: null,
        valor_de_mercado: null,
        resultado_nao_realizado: null,
        rentabilidade: null,
      };
    }

    const valor = d(pos.quantidade).times(d(preco));
    const custo = d(pos.custo_total);

    return {
      ...pos,
      preco_atual: preco,
      valor_de_mercado: moeda(valor),
      resultado_nao_realizado: moeda(valor.minus(custo)),
      rentabilidade: numero(dividir(valor.minus(custo), custo), 6),
    };
  });
}
