import type { Decimal } from "decimal.js";
import { d, dividir, moeda, numero } from "./decimal.js";
import type { PosicaoAvaliada } from "./posicao.js";
import type { ClasseDePosicao, Transacao } from "./tipos.js";

/** Renda variavel a mercado ou posicao sem ticker pelo saldo do extrato. */
export type ItemDeAlocacao = Pick<PosicaoAvaliada, "ticker" | "valor_de_mercado">;

/** Rotulo na alocacao. Os quatro primeiros sao os mesmos da renda variavel. */
export const CLASSE_DE_ALOCACAO: Record<ClasseDePosicao, string> = {
  acao: "Ações",
  fii: "FIIs",
  bdr: "BDRs",
  etf: "ETFs",
  fundo: "Fundos",
  renda_fixa: "Renda fixa",
  titulo_publico: "Títulos públicos",
  previdencia: "Previdência",
  coe: "COE",
  estruturado: "Estruturados",
  cripto: "Cripto",
  outro: "Outros",
};

export interface FatiaDeAlocacao {
  chave: string;
  valor: string;
  fracao: number | null;
}

/**
 * Aloca por uma chave qualquer (classe, setor, ativo).
 *
 * Posicao sem preco de mercado fica de fora, e nao entra como zero: contar
 * valor desconhecido como zero diluiria todas as outras fatias e daria um
 * grafico errado sem aviso.
 */
export function alocar(
  posicoes: ItemDeAlocacao[],
  chaveDe: (p: ItemDeAlocacao) => string,
): FatiaDeAlocacao[] {
  const soma = new Map<string, Decimal>();
  let total = d(0);

  for (const p of posicoes) {
    if (p.valor_de_mercado === null) continue;
    const v = d(p.valor_de_mercado);
    if (v.lte(0)) continue;

    const k = chaveDe(p);
    soma.set(k, (soma.get(k) ?? d(0)).plus(v));
    total = total.plus(v);
  }

  return [...soma.entries()]
    .sort((a, b) => b[1].comparedTo(a[1]))
    .map(([chave, valor]) => ({
      chave,
      valor: moeda(valor),
      fracao: numero(dividir(valor, total), 6),
    }));
}

export interface ProventoMensal {
  mes: string;
  valor: string;
}

/** Proventos recebidos por mes, do mais antigo ao mais recente. */
export function proventosPorMes(transacoes: Transacao[]): ProventoMensal[] {
  const porMes = new Map<string, Decimal>();

  for (const t of transacoes) {
    if (t.tipo !== "provento") continue;
    const mes = t.data.slice(0, 7);
    const valor = d(t.quantidade).times(d(t.preco)).minus(d(t.taxas));
    porMes.set(mes, (porMes.get(mes) ?? d(0)).plus(valor));
  }

  return [...porMes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, valor]) => ({ mes, valor: moeda(valor) }));
}
