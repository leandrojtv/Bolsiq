import type { Decimal } from "decimal.js";
import { d, moeda } from "./decimal.js";
import { apurar, type ResultadoDeApuracao } from "./posicao.js";
import type { Transacao } from "./tipos.js";
import { twrDiario } from "./twr.js";

export interface Fechamento {
  date: string;
  close: string;
}

export interface LinhaDeSnapshot {
  data: string;
  valor_bruto: string;
  custo_total: string;
  resultado_nao_realizado: string;
  resultado_realizado_acumulado: string;
  proventos_acumulados: string;
  fluxo_caixa: string;
  retorno_twr: number | null;
  base_100: number;
}

/**
 * Fluxo de caixa da transacao do ponto de vista da carteira: compra e aporte
 * (positivo, com a taxa), venda e provento sao retirada (negativo, liquido da
 * taxa). Evento sem desembolso nao e fluxo.
 */
export function fluxoDaTransacao(t: Transacao): Decimal {
  const bruto = d(t.quantidade).times(d(t.preco));
  if (t.tipo === "compra") return bruto.plus(d(t.taxas));
  if (t.tipo === "venda" || t.tipo === "provento") return bruto.minus(d(t.taxas)).neg();
  return d(0);
}

/** Dias de pregao entre `de` e `ate`: a uniao das datas com fechamento. */
export function diasDePregao(
  fechamentos: Record<string, Fechamento[]>,
  de: string,
  ate: string,
): string[] {
  const dias = new Set<string>();
  for (const serie of Object.values(fechamentos))
    for (const f of serie) if (f.date >= de && f.date <= ate) dias.add(f.date);
  return [...dias].sort();
}

/**
 * Snapshot de cada dia de pregao: valor a mercado, custo, resultados e TWR.
 *
 * Preco do dia e o ultimo fechamento ate a data. Ativo sem nenhum fechamento
 * ainda (IPO recente, ticker fora da base) entra pelo custo: tira-lo do valor
 * faria o TWR registrar uma perda que nao houve.
 *
 * Transacao em dia sem pregao (lancada num sabado) cai no pregao seguinte.
 */
export function snapshotsDiarios(
  transacoes: Transacao[],
  fechamentos: Record<string, Fechamento[]>,
  dias: string[],
): LinhaDeSnapshot[] {
  const ordenadas = [...transacoes].sort((a, b) => a.data.localeCompare(b.data));
  const series = Object.fromEntries(
    Object.entries(fechamentos).map(([t, s]) => [
      t,
      [...s].sort((a, b) => a.date.localeCompare(b.date)),
    ]),
  );
  const cursor = new Map<string, number>();
  const ultimo = new Map<string, string>();

  let incluidas = 0;
  let apuracao: ResultadoDeApuracao = apurar([]);
  const linhas: Omit<LinhaDeSnapshot, "retorno_twr" | "base_100">[] = [];

  for (const dia of [...dias].sort()) {
    let fluxo = d(0);
    const antes = incluidas;
    while (incluidas < ordenadas.length && (ordenadas[incluidas]?.data ?? "") <= dia) {
      fluxo = fluxo.plus(fluxoDaTransacao(ordenadas[incluidas] as Transacao));
      incluidas++;
    }
    if (incluidas !== antes) apuracao = apurar(ordenadas.slice(0, incluidas));

    for (const [ticker, serie] of Object.entries(series)) {
      let i = cursor.get(ticker) ?? 0;
      while (i < serie.length && (serie[i]?.date ?? "") <= dia) {
        ultimo.set(ticker, serie[i]?.close ?? "0");
        i++;
      }
      cursor.set(ticker, i);
    }

    let valor = d(0);
    let custo = d(0);
    for (const p of apuracao.posicoes) {
      if (d(p.quantidade).lte(0)) continue;
      const preco = ultimo.get(p.ticker) ?? p.preco_medio;
      valor = valor.plus(d(p.quantidade).times(d(preco)));
      custo = custo.plus(d(p.custo_total));
    }

    linhas.push({
      data: dia,
      valor_bruto: moeda(valor),
      custo_total: moeda(custo),
      resultado_nao_realizado: moeda(valor.minus(custo)),
      resultado_realizado_acumulado: apuracao.resultado_realizado_total,
      proventos_acumulados: apuracao.proventos_total,
      fluxo_caixa: moeda(fluxo),
    });
  }

  const twr = twrDiario(
    linhas.map((l) => ({
      data: l.data,
      valor: l.valor_bruto,
      fluxo_caixa: l.fluxo_caixa,
    })),
  );
  return linhas.map((l, i) => ({
    ...l,
    retorno_twr: twr[i]?.retorno_diario ?? null,
    base_100: twr[i]?.base_100 ?? 100,
  }));
}

/** Aviso da tabela de posicoes: "Desdobramento 1:2 aplicado". */
export function eventosAplicados(transacoes: Transacao[]): Map<string, string> {
  const nomes = {
    desdobramento: "Desdobramento",
    grupamento: "Grupamento",
    bonificacao: "Bonificação",
  } as const;
  const avisos = new Map<string, string>();
  for (const t of [...transacoes].sort((a, b) => a.data.localeCompare(b.data))) {
    if (t.tipo === "desdobramento")
      avisos.set(
        t.ticker,
        `${nomes.desdobramento} 1:${d(t.quantidade).toString()} aplicado`,
      );
    else if (t.tipo === "grupamento")
      avisos.set(
        t.ticker,
        `${nomes.grupamento} ${d(t.quantidade).toString()}:1 aplicado`,
      );
    else if (t.tipo === "bonificacao")
      avisos.set(t.ticker, `${nomes.bonificacao} aplicada`);
  }
  return avisos;
}
