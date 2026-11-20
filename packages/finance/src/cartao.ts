/**
 * Ciclo da fatura do cartao. A fatura e identificada pelo vencimento; o
 * fechamento cai no mesmo mes quando o dia de fechamento e anterior ao de
 * vencimento, senao no mes anterior. Dia 31 num mes de 30 vira o ultimo dia.
 *
 * Compra feita ate o dia do fechamento (inclusive) entra na fatura do ciclo;
 * depois do fechamento, na seguinte.
 */
export interface CicloDoCartao {
  dia_fechamento: number;
  dia_vencimento: number;
}

export interface Fatura {
  vencimento: string;
  fechamento: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

function diaNoMes(ano: number, mes: number, dia: number): string {
  // mes de 1 a 12, podendo transbordar para outro ano.
  const base = new Date(Date.UTC(ano, mes - 1, 1));
  const ultimo = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(Math.min(dia, ultimo))}`;
}

/** A fatura que vence no mes de `ano`/`mes` (1 a 12). */
export function faturaDoMes(c: CicloDoCartao, ano: number, mes: number): Fatura {
  const mesDoFechamento = c.dia_fechamento < c.dia_vencimento ? mes : mes - 1;
  return {
    vencimento: diaNoMes(ano, mes, c.dia_vencimento),
    fechamento: diaNoMes(ano, mesDoFechamento, c.dia_fechamento),
  };
}

/** A fatura em que entra uma compra (ou pagamento) feita em `data`. */
export function faturaDaCompra(c: CicloDoCartao, data: string): Fatura {
  const ano = Number(data.slice(0, 4));
  const mes = Number(data.slice(5, 7));
  for (let k = 0; k <= 3; k++) {
    const f = faturaDoMes(c, ano, mes + k);
    if (data <= f.fechamento) return f;
  }
  /* c8 ignore next */
  throw new Error("ciclo de cartao invalido");
}

/** Primeiro dia do mes do vencimento: a competencia da fatura. */
export const competenciaDaFatura = (f: Fatura) => `${f.vencimento.slice(0, 7)}-01`;

/** Status pela data: aberta ate o dia do fechamento, fechada depois. Paga vem do banco. */
export const fechou = (f: Fatura, hoje: string) => hoje > f.fechamento;

/** Faturas de `antes` ciclos atras ate `depois` ciclos a frente da de `hoje`. */
export function faturasAoRedor(
  c: CicloDoCartao,
  hoje: string,
  antes = 6,
  depois = 2,
): Fatura[] {
  const atual = faturaDaCompra(c, hoje);
  const ano = Number(atual.vencimento.slice(0, 4));
  const mes = Number(atual.vencimento.slice(5, 7));
  const lista: Fatura[] = [];
  for (let k = -antes; k <= depois; k++) lista.push(faturaDoMes(c, ano, mes + k));
  return lista;
}
