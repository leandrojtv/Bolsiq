import {
  faturaDaCompra,
  faturaDoMes,
  type CicloDoCartao,
  type Fatura,
} from "./cartao.js";
import { d, moeda } from "./decimal.js";

/** Divide o total em n parcelas a centavos; o residuo vai na primeira. */
export function dividirTotal(total: string, n: number): string[] {
  const base = d(total).div(n).toDecimalPlaces(2, 1);
  const resto = d(total).minus(base.times(n));
  return Array.from({ length: n }, (_, k) => moeda(k === 0 ? base.plus(resto) : base));
}

export interface ParcelaNoCartao {
  numero: number;
  /** Compra na primeira; nas demais, o fechamento da fatura (dentro do ciclo). */
  data: string;
  fatura: Fatura;
  valor: string;
}

/** Uma parcela em cada fatura, a partir da fatura da compra. */
export function parcelasNoCartao(
  ciclo: CicloDoCartao,
  dataDaCompra: string,
  valores: string[],
  desde = 1,
): ParcelaNoCartao[] {
  const primeira = faturaDaCompra(ciclo, dataDaCompra);
  const ano = Number(primeira.vencimento.slice(0, 4));
  const mes = Number(primeira.vencimento.slice(5, 7));
  return valores
    .map((valor, k) => {
      const fatura = faturaDoMes(ciclo, ano, mes + k);
      return {
        numero: k + 1,
        data: k === 0 ? dataDaCompra : fatura.fechamento,
        fatura,
        valor,
      };
    })
    .filter((p) => p.numero >= desde);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Mesma data em meses seguintes; dia 31 vira o ultimo dia do mes. */
export function somarMeses(data: string, meses: number): string {
  const ano = Number(data.slice(0, 4));
  const mes = Number(data.slice(5, 7)) - 1 + meses;
  const dia = Number(data.slice(8, 10));
  const base = new Date(Date.UTC(ano, mes, 1));
  const ultimo = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(Math.min(dia, ultimo))}`;
}
