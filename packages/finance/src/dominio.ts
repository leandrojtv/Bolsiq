import { d, moeda } from "./decimal.js";
import type { LancamentoBase, Sentido, StatusDeLancamento } from "./tipos.js";

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Primeiro dia do mes da data (YYYY-MM-DD). */
export function competenciaDe(data: string): string {
  if (!DATA.test(data)) throw new Error(`data invalida: ${data}`);
  return `${data.slice(0, 7)}-01`;
}

/** Maiusculas, sem acento, sem pontuacao repetida e com espacos simples. */
export function normalizarDescricao(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CONTA_NO_SALDO: StatusDeLancamento[] = ["realizado", "conciliado"];

/**
 * Quanto o lancamento move o saldo da conta: receita soma, despesa subtrai, e a
 * transferencia segue o sentido. Valor sempre positivo no banco.
 */
export function efeitoNoSaldo(
  l: Pick<LancamentoBase, "tipo" | "valor" | "transferencia_sentido">,
): string {
  const v = d(l.valor);
  if (l.tipo === "receita") return moeda(v);
  if (l.tipo === "despesa") return moeda(v.neg());
  if (l.transferencia_sentido === null) throw new Error("transferencia sem sentido");
  return moeda(l.transferencia_sentido === "entrada" ? v : v.neg());
}

export interface ContaParaSaldo {
  saldo_inicial: string;
  /** O saldo inicial vale no inicio deste dia (ADR 0031). */
  data_saldo_inicial: string;
}

/**
 * Saldo da conta no fim do dia `data`. So realizado e conciliado contam, a menos
 * que `incluirPrevistos` (saldo previsto). Antes da data do saldo inicial nao ha
 * saldo conhecido: devolve null.
 */
export function saldoNaData(
  conta: ContaParaSaldo,
  lancamentos: Pick<
    LancamentoBase,
    "tipo" | "valor" | "data" | "status" | "transferencia_sentido"
  >[],
  data: string,
  { incluirPrevistos = false }: { incluirPrevistos?: boolean } = {},
): string | null {
  if (data < conta.data_saldo_inicial) return null;
  let saldo = d(conta.saldo_inicial);
  for (const l of lancamentos) {
    if (l.data < conta.data_saldo_inicial || l.data > data) continue;
    if (!incluirPrevistos && !CONTA_NO_SALDO.includes(l.status)) continue;
    saldo = saldo.plus(efeitoNoSaldo(l));
  }
  return moeda(saldo);
}

export interface TotalPorStatus {
  previsto: string;
  /** Realizado e conciliado. */
  realizado: string;
  total: string;
}

export interface TotaisDoMes {
  competencia: string;
  receita: TotalPorStatus;
  despesa: TotalPorStatus;
  /** Receita menos despesa, total (previsto e realizado). */
  resultado: string;
}

/**
 * Totais do mes por natureza e status. Transferencia nunca entra: e dinheiro
 * mudando de conta, nao receita nem despesa.
 */
export function totaisDoMes(
  lancamentos: Pick<LancamentoBase, "tipo" | "valor" | "competencia" | "status">[],
  competencia: string,
): TotaisDoMes {
  const soma = {
    receita: { previsto: d(0), realizado: d(0) },
    despesa: { previsto: d(0), realizado: d(0) },
  };
  for (const l of lancamentos) {
    if (l.competencia !== competencia || l.tipo === "transferencia") continue;
    const alvo = soma[l.tipo];
    if (l.status === "previsto") alvo.previsto = alvo.previsto.plus(l.valor);
    else alvo.realizado = alvo.realizado.plus(l.valor);
  }
  const fechar = (s: {
    previsto: ReturnType<typeof d>;
    realizado: ReturnType<typeof d>;
  }) => ({
    previsto: moeda(s.previsto),
    realizado: moeda(s.realizado),
    total: moeda(s.previsto.plus(s.realizado)),
  });
  return {
    competencia,
    receita: fechar(soma.receita),
    despesa: fechar(soma.despesa),
    resultado: moeda(
      soma.receita.previsto
        .plus(soma.receita.realizado)
        .minus(soma.despesa.previsto)
        .minus(soma.despesa.realizado),
    ),
  };
}

export interface PedidoDeTransferencia {
  de: string;
  para: string;
  valor: string;
  data: string;
  descricao: string;
  status: StatusDeLancamento;
  observacao?: string | null;
}

export interface LadoDaTransferencia {
  id: string;
  account_id: string;
  tipo: "transferencia";
  valor: string;
  data: string;
  competencia: string;
  descricao: string;
  descricao_normalizada: string;
  category_id: null;
  status: StatusDeLancamento;
  transferencia_par_id: string;
  transferencia_sentido: Sentido;
  observacao: string | null;
}

/**
 * Os dois lados de uma transferencia, um apontando para o outro. A gravacao e
 * uma transacao so (`criarTransferenciaNoBanco`); aqui so a forma.
 */
export function montarTransferencia(
  p: PedidoDeTransferencia,
  ids: { saida: string; entrada: string },
): [LadoDaTransferencia, LadoDaTransferencia] {
  if (p.de === p.para) throw new Error("transferencia para a mesma conta");
  if (!d(p.valor).gt(0)) throw new Error("valor da transferencia precisa ser positivo");
  const comum = {
    tipo: "transferencia" as const,
    valor: moeda(d(p.valor)),
    data: p.data,
    competencia: competenciaDe(p.data),
    descricao: p.descricao,
    descricao_normalizada: normalizarDescricao(p.descricao),
    category_id: null,
    status: p.status,
    observacao: p.observacao ?? null,
  };
  return [
    {
      ...comum,
      id: ids.saida,
      account_id: p.de,
      transferencia_par_id: ids.entrada,
      transferencia_sentido: "saida",
    },
    {
      ...comum,
      id: ids.entrada,
      account_id: p.para,
      transferencia_par_id: ids.saida,
      transferencia_sentido: "entrada",
    },
  ];
}
