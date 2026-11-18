import { randomUUID } from "node:crypto";
import type { Decimal } from "decimal.js";
import { d, moeda, qtd } from "./decimal.js";
import type { Transacao } from "./tipos.js";

export interface EventoCorporativo {
  /** Id do evento no barramento. Vira `origem_evento_id`. */
  event_id: string;
  ticker: string;
  kind: "dividendo" | "jcp" | "bonificacao" | "desdobramento" | "grupamento";
  value_per_share: string | null;
  /** "1:2" em desdobramento, "10:1" em grupamento. */
  ratio: string | null;
  ex_date: string;
}

export interface Aplicacao {
  transacoes: Transacao[];
  ignorado?: string;
}

/**
 * Traduz um evento corporativo em transacoes da carteira.
 *
 * O evento so gera transacao se havia posicao na data ex. Posicao zero na data
 * ex nao recebe provento nem sofre desdobramento, e aplicar o evento ali
 * criaria quantidade do nada.
 *
 * `origem_evento_id` vai em toda transacao gerada. Com o indice unico
 * `(portfolio_id, origem_evento_id)`, reprocessar o mesmo evento nao duplica,
 * o que importa porque a entrega e at-least-once (ADR 0008).
 */
export function aplicarEvento(
  evento: EventoCorporativo,
  quantidadeNaDataEx: string,
): Aplicacao {
  const q = d(quantidadeNaDataEx);
  if (q.lte(0)) {
    return { transacoes: [], ignorado: "sem posicao na data ex" };
  }

  const base = {
    id: randomUUID(),
    ticker: evento.ticker,
    data: evento.ex_date,
    taxas: "0",
  };

  switch (evento.kind) {
    case "dividendo":
    case "jcp": {
      if (evento.value_per_share === null) {
        return { transacoes: [], ignorado: "provento sem valor por acao" };
      }
      return {
        transacoes: [
          {
            ...base,
            tipo: "provento",
            quantidade: qtd(q),
            preco: evento.value_per_share,
          },
        ],
      };
    }

    case "desdobramento":
    case "grupamento": {
      const fator = fatorDaRazao(evento.ratio, evento.kind);
      if (fator === null) {
        return { transacoes: [], ignorado: `razao invalida: ${String(evento.ratio)}` };
      }
      return {
        transacoes: [
          { ...base, tipo: evento.kind, quantidade: moeda(fator, 8), preco: "0" },
        ],
      };
    }

    case "bonificacao": {
      // Bonificacao entra como quantidade nova ao preco de emissao informado.
      // Sem preco, entra a custo zero, o que reduz o preco medio -- e o
      // tratamento correto quando a empresa nao divulga preco de emissao.
      const fator = fatorDaRazao(evento.ratio, "desdobramento");
      if (fator === null) {
        return { transacoes: [], ignorado: `razao invalida: ${String(evento.ratio)}` };
      }
      const novas = q.times(fator.minus(1));
      if (novas.lte(0))
        return { transacoes: [], ignorado: "bonificacao sem acoes novas" };

      return {
        transacoes: [
          {
            ...base,
            tipo: "bonificacao",
            quantidade: qtd(novas),
            preco: evento.value_per_share ?? "0",
          },
        ],
      };
    }
  }
}

/**
 * Converte "1:2" no fator que multiplica a quantidade.
 *
 * Em desdobramento 1:2, cada acao vira duas, entao o fator e 2. Em grupamento
 * 10:1, dez acoes viram uma, e o fator guardado e 10 -- a transacao de
 * grupamento divide por ele. Trocar a ordem de leitura aqui inverte a posicao
 * do usuario por um fator de 100 em casos reais, e e um erro que nao aparece
 * em teste com razao 1:1.
 */
export function fatorDaRazao(
  ratio: string | null,
  kind: "desdobramento" | "grupamento",
): Decimal | null {
  if (ratio === null) return null;

  const achado = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(ratio.trim());
  if (!achado) return null;

  const esquerda = d(achado[1] ?? "0");
  const direita = d(achado[2] ?? "0");
  if (esquerda.lte(0) || direita.lte(0)) return null;

  return kind === "desdobramento" ? direita.div(esquerda) : esquerda.div(direita);
}
