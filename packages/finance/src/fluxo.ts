import { d, moeda } from "./decimal.js";

/**
 * Fluxo de caixa projetado. Saldo das contas hoje mais cada movimento futuro
 * (com sinal); o que esta atrasado entra no primeiro mes.
 */
export interface Movimento {
  data: string;
  /** Positivo entra, negativo sai. */
  valor: string;
}

export interface MesDoFluxo {
  mes: string;
  entradas: string;
  saidas: string;
  saldo_final: string;
}

export interface FluxoProjetado {
  saldo_inicial: string;
  meses: MesDoFluxo[];
  primeiro_mes_negativo: string | null;
}

const proximoMes = (mes: string) => {
  const t = new Date(`${mes}-01T00:00:00Z`);
  t.setUTCMonth(t.getUTCMonth() + 1);
  return t.toISOString().slice(0, 7);
};

export function fluxoProjetado(
  saldoInicial: string,
  movimentos: Movimento[],
  hoje: string,
  n: number,
): FluxoProjetado {
  const meses: string[] = [hoje.slice(0, 7)];
  while (meses.length < n) meses.push(proximoMes(meses.at(-1) as string));
  const porMes = new Map(meses.map((m) => [m, { e: d(0), s: d(0) }]));
  for (const m of movimentos) {
    const chave = m.data.slice(0, 7) < meses[0]! ? meses[0]! : m.data.slice(0, 7);
    const alvo = porMes.get(chave);
    if (!alvo) continue;
    const v = d(m.valor);
    if (v.gte(0)) alvo.e = alvo.e.plus(v);
    else alvo.s = alvo.s.plus(v.neg());
  }
  let saldo = d(saldoInicial);
  let negativo: string | null = null;
  const resultado = meses.map((mes) => {
    const x = porMes.get(mes)!;
    saldo = saldo.plus(x.e).minus(x.s);
    if (negativo === null && saldo.lt(0)) negativo = mes;
    return { mes, entradas: moeda(x.e), saidas: moeda(x.s), saldo_final: moeda(saldo) };
  });
  return {
    saldo_inicial: moeda(d(saldoInicial)),
    meses: resultado,
    primeiro_mes_negativo: negativo,
  };
}
