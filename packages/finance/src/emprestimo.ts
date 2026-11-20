import { Decimal } from "decimal.js";
import { d, moeda } from "./decimal.js";

/**
 * Tabelas de amortizacao. Cada linha arredonda juros e amortizacao a
 * centavos; a ultima parcela absorve o residuo para o saldo fechar em zero.
 */
export const SISTEMAS = ["sem_juros", "price", "sac"] as const;
export type Sistema = (typeof SISTEMAS)[number];

export interface LinhaDaTabela {
  numero: number;
  parcela: string;
  juros: string;
  amortizacao: string;
  saldo: string;
}

const centavos = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** Parcela fixa da Price: PV * i / (1 - (1 + i)^-n). Sem juros, PV / n. */
export function parcelaPrice(principal: string, taxa: string, n: number): string {
  const pv = d(principal);
  const i = d(taxa);
  if (i.isZero()) return moeda(centavos(pv.div(n)));
  return moeda(centavos(pv.times(i).div(d(1).minus(i.plus(1).pow(-n)))));
}

/** Tabela com parcela fixa ate quitar (Price, ou Price com prazo reduzido). */
function tabelaDeParcelaFixa(
  principal: string,
  taxa: string,
  parcela: string,
  max: number,
) {
  const i = d(taxa);
  const pmt = d(parcela);
  let saldo = d(principal);
  const linhas: LinhaDaTabela[] = [];
  for (let k = 1; k <= max && saldo.gt(0); k++) {
    const juros = centavos(saldo.times(i));
    let amort = pmt.minus(juros);
    if (k === max || amort.gte(saldo)) amort = saldo;
    if (amort.lte(0)) throw new Error("parcela nao cobre os juros");
    saldo = saldo.minus(amort);
    linhas.push({
      numero: k,
      parcela: moeda(juros.plus(amort)),
      juros: moeda(juros),
      amortizacao: moeda(amort),
      saldo: moeda(saldo),
    });
  }
  return linhas;
}

export function tabelaPrice(principal: string, taxa: string, n: number): LinhaDaTabela[] {
  return tabelaDeParcelaFixa(principal, taxa, parcelaPrice(principal, taxa, n), n);
}

/** Tabela com amortizacao constante (SAC). */
function tabelaDeAmortizacaoFixa(
  principal: string,
  taxa: string,
  amortizacao: Decimal,
  max: number,
) {
  const i = d(taxa);
  let saldo = d(principal);
  const linhas: LinhaDaTabela[] = [];
  for (let k = 1; k <= max && saldo.gt(0); k++) {
    const juros = centavos(saldo.times(i));
    const amort = k === max || amortizacao.gte(saldo) ? saldo : amortizacao;
    saldo = saldo.minus(amort);
    linhas.push({
      numero: k,
      parcela: moeda(juros.plus(amort)),
      juros: moeda(juros),
      amortizacao: moeda(amort),
      saldo: moeda(saldo),
    });
  }
  return linhas;
}

export function tabelaSac(principal: string, taxa: string, n: number): LinhaDaTabela[] {
  return tabelaDeAmortizacaoFixa(principal, taxa, centavos(d(principal).div(n)), n);
}

export function tabela(sistema: Sistema, principal: string, taxa: string, n: number) {
  return sistema === "sac"
    ? tabelaSac(principal, taxa, n)
    : tabelaPrice(principal, taxa, n);
}

export const somaDosJuros = (t: LinhaDaTabela[]) =>
  moeda(t.reduce((s, l) => s.plus(l.juros), d(0)));

export type ModoDeAmortizacao = "reduzir_prazo" | "reduzir_parcela";

export interface Simulacao {
  antes: { parcelas: number; primeira_parcela: string; juros: string };
  depois: { parcelas: number; primeira_parcela: string; juros: string };
  juros_economizados: string;
  tabela: LinhaDaTabela[];
}

/**
 * Amortizacao extra sobre o saldo devedor atual. Reduzir prazo mantem a
 * parcela (Price) ou a amortizacao (SAC) e encurta; reduzir parcela mantem o
 * prazo e recalcula. Extra maior ou igual ao saldo quita.
 */
export function simularAmortizacao(p: {
  sistema: Exclude<Sistema, "sem_juros">;
  saldo_devedor: string;
  taxa: string;
  parcelas_restantes: number;
  extra: string;
  modo: ModoDeAmortizacao;
}): Simulacao {
  const antes = tabela(p.sistema, p.saldo_devedor, p.taxa, p.parcelas_restantes);
  const novoSaldo = d(p.saldo_devedor).minus(p.extra);
  let depois: LinhaDaTabela[] = [];
  if (novoSaldo.gt(0)) {
    if (p.modo === "reduzir_parcela")
      depois = tabela(p.sistema, moeda(novoSaldo), p.taxa, p.parcelas_restantes);
    else if (p.sistema === "price")
      depois = tabelaDeParcelaFixa(
        moeda(novoSaldo),
        p.taxa,
        antes[0]?.parcela ?? "0",
        p.parcelas_restantes,
      );
    else {
      // A amortizacao arredondada deixa centavos de residuo: eles vao na ultima
      // parcela em vez de abrir mais uma.
      const amort = d(antes[0]?.amortizacao ?? "0");
      const prazo = Math.ceil(novoSaldo.div(amort).minus(0.0001).toNumber());
      depois = tabelaDeAmortizacaoFixa(moeda(novoSaldo), p.taxa, amort, prazo);
    }
  }
  const jurosAntes = somaDosJuros(antes);
  const jurosDepois = somaDosJuros(depois);
  return {
    antes: {
      parcelas: antes.length,
      primeira_parcela: antes[0]?.parcela ?? "0.00",
      juros: jurosAntes,
    },
    depois: {
      parcelas: depois.length,
      primeira_parcela: depois[0]?.parcela ?? "0.00",
      juros: jurosDepois,
    },
    juros_economizados: moeda(d(jurosAntes).minus(jurosDepois)),
    tabela: depois,
  };
}

export interface EventoDaDivida {
  data: string;
  /** parcela: juros do mes sobre o saldo, o resto amortiza. extra: amortiza tudo. */
  tipo: "parcela" | "extra";
  valor: string;
}

/**
 * Saldo devedor depois dos eventos ja realizados, em ordem de data. Deriva do
 * historico para continuar certo depois de amortizacao extra.
 */
export function saldoDevedor(
  principal: string,
  taxa: string,
  eventos: EventoDaDivida[],
): string {
  const i = d(taxa);
  let saldo = d(principal);
  for (const e of [...eventos].sort((a, b) => a.data.localeCompare(b.data))) {
    const amort =
      e.tipo === "extra" ? d(e.valor) : d(e.valor).minus(centavos(saldo.times(i)));
    saldo = Decimal.max(0, saldo.minus(amort));
  }
  return moeda(saldo);
}
