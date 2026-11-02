import { Decimal } from "decimal.js";

export interface Vela {
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: number;
  financial_volume: string;
}

export interface EventoDeAjuste {
  /** Primeiro pregao sem direito. */
  exDate: string;
  kind: "dividendo" | "jcp" | "bonificacao" | "desdobramento" | "grupamento";
  /** Valor por acao, para dividendo e JCP. */
  valuePerShare: string | null;
  /** Multiplicador de acoes: 2 em desdobramento 1:2, 0.01 em grupamento 100:1. */
  factor: string | null;
}

const CASAS = 6;

/**
 * Ajusta a serie por proventos e eventos societarios (ajuste para tras).
 *
 * O preco mais recente fica igual ao negociado; cada evento multiplica todos
 * os precos anteriores a sua data-ex:
 *
 * - dividendo e JCP: `1 - D / P`, com P o fechamento bruto do ultimo pregao
 *   com direito. E o metodo da B3 e da maioria dos provedores.
 * - desdobramento, grupamento e bonificacao: preco dividido pelo multiplicador
 *   de acoes, volume multiplicado por ele.
 *
 * Evento com dado incoerente (provento maior que o preco, multiplicador nao
 * positivo) e ignorado em vez de produzir preco negativo ou infinito.
 */
export function ajustarPorProventos(velas: Vela[], eventos: EventoDeAjuste[]): Vela[] {
  if (velas.length === 0 || eventos.length === 0) return velas;

  const ordenadas = [...velas].sort((a, b) => (a.date < b.date ? 1 : -1));
  const pendentes = [...eventos].sort((a, b) => (a.exDate < b.exDate ? 1 : -1));

  let fatorPreco = new Decimal(1);
  let fatorVolume = new Decimal(1);
  let i = 0;
  const saida: Vela[] = [];

  for (const vela of ordenadas) {
    // Todo evento com data-ex depois desta vela passa a valer para ela.
    while (i < pendentes.length && (pendentes[i]?.exDate ?? "") > vela.date) {
      const ev = pendentes[i] as EventoDeAjuste;
      i++;

      if (ev.kind === "dividendo" || ev.kind === "jcp") {
        if (ev.valuePerShare === null) continue;
        const preco = new Decimal(vela.close);
        const provento = new Decimal(ev.valuePerShare);
        if (preco.lte(0) || provento.lte(0) || provento.gte(preco)) continue;
        fatorPreco = fatorPreco.times(new Decimal(1).minus(provento.div(preco)));
      } else {
        if (ev.factor === null) continue;
        const multiplicador = new Decimal(ev.factor);
        if (multiplicador.lte(0)) continue;
        fatorPreco = fatorPreco.div(multiplicador);
        fatorVolume = fatorVolume.times(multiplicador);
      }
    }

    if (fatorPreco.eq(1) && fatorVolume.eq(1)) {
      saida.push(vela);
      continue;
    }

    const ajustar = (v: string) =>
      new Decimal(v).times(fatorPreco).toDecimalPlaces(CASAS).toFixed();
    saida.push({
      ...vela,
      open: ajustar(vela.open),
      high: ajustar(vela.high),
      low: ajustar(vela.low),
      close: ajustar(vela.close),
      volume: new Decimal(vela.volume).times(fatorVolume).round().toNumber(),
    });
  }

  return saida.reverse();
}

/**
 * Agrega velas diarias em semanais (segunda a domingo) ou mensais.
 *
 * A data da vela agregada e o primeiro pregao do periodo, nao o primeiro dia
 * do calendario: segunda-feira de feriado nao existe na serie.
 */
export function agregarVelas(velas: Vela[], intervalo: "1d" | "1wk" | "1mo"): Vela[] {
  if (intervalo === "1d") return velas;

  const chave = intervalo === "1wk" ? inicioDaSemana : (d: string) => d.slice(0, 7);
  const ordenadas = [...velas].sort((a, b) => (a.date < b.date ? -1 : 1));
  const saida: Vela[] = [];
  let atual: Vela | null = null;
  let chaveAtual = "";

  for (const v of ordenadas) {
    const k = chave(v.date);
    if (atual === null || k !== chaveAtual) {
      if (atual) saida.push(atual);
      atual = { ...v };
      chaveAtual = k;
      continue;
    }
    atual.high = Decimal.max(atual.high, v.high).toFixed();
    atual.low = Decimal.min(atual.low, v.low).toFixed();
    atual.close = v.close;
    atual.volume += v.volume;
    atual.financial_volume = new Decimal(atual.financial_volume)
      .plus(v.financial_volume)
      .toFixed();
  }
  if (atual) saida.push(atual);
  return saida;
}

function inicioDaSemana(data: string): string {
  const d = new Date(`${data}T00:00:00Z`);
  // getUTCDay: domingo 0. Semana ISO comeca na segunda.
  const recuo = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - recuo);
  return d.toISOString().slice(0, 10);
}
