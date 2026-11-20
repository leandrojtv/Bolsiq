import { d, moeda } from "./decimal.js";
import { somarDias } from "./recorrencia.js";

/**
 * Regras dos alertas do Bolsiq Financas (ADR 0037). Funcoes puras: recebem o
 * estado do usuario e devolvem os fatos a avisar, cada um com uma `chave`
 * estavel. O job `finance.vigia` grava a chave em `emitted_alerts` e so publica
 * o que ainda nao tinha sido avisado.
 */

export const EVENTO_FATURA_VENCENDO = "finance.fatura.vencendo.v1";
export const EVENTO_ORCAMENTO_LIMITE = "finance.orcamento.limite.v1";
export const EVENTO_SALDO_NEGATIVO = "finance.saldo.negativo.v1";
export const EVENTO_RECEITA_ATRASADA = "finance.receita.atrasada.v1";

/** Fatura: avisa com ate 3 dias para o vencimento. */
export const DIAS_ANTES_DO_VENCIMENTO = 3;
/** Limiares do orcamento por categoria, em %. */
export const LIMIARES_DO_ORCAMENTO = [80, 100] as const;
/** Meses do fluxo projetado olhados pelo alerta de saldo negativo. */
export const MESES_DO_FLUXO_VIGIADO = 3;

export interface Fato {
  evento: string;
  chave: string;
  payload: Record<string, unknown>;
}

const dias = (de: string, ate: string) =>
  Math.round(
    (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000,
  );

export interface FaturaAPagar {
  id: string;
  card_id: string;
  cartao: string;
  vencimento: string;
  status: "aberta" | "fechada" | "paga";
  /** Compras menos estornos. */
  total: string;
  /** Pagamentos realizados. */
  pagamentos: string;
}

export function faturasVencendo(faturas: FaturaAPagar[], hoje: string): Fato[] {
  const limite = somarDias(hoje, DIAS_ANTES_DO_VENCIMENTO);
  return faturas.flatMap((f) => {
    const aPagar = d(f.total).minus(f.pagamentos);
    if (f.status === "paga" || aPagar.lte(0)) return [];
    if (f.vencimento < hoje || f.vencimento > limite) return [];
    const chave = `fatura_vencendo:${f.id}`;
    return [
      {
        evento: EVENTO_FATURA_VENCENDO,
        chave,
        payload: {
          chave,
          statement_id: f.id,
          card_id: f.card_id,
          cartao: f.cartao,
          vencimento: f.vencimento,
          valor: moeda(aPagar),
          dias: dias(hoje, f.vencimento),
        },
      },
    ];
  });
}

export interface CategoriaDoOrcamento {
  category_id: string;
  nome: string;
  natureza: "receita" | "despesa";
  planejado: string;
  /** Realizado + previsto. */
  consumo: string;
}

/**
 * Categoria de despesa com planejado e consumo em 80% ou 100%. Um fato por
 * limiar: quem pula direto para 120% recebe os dois de uma vez, e o 100% e o
 * que importa; por isso a ordem e do maior para o menor.
 */
export function limitesDoOrcamento(
  categorias: CategoriaDoOrcamento[],
  mes: string,
): Fato[] {
  return categorias.flatMap((c) => {
    if (c.natureza !== "despesa" || d(c.planejado).lte(0)) return [];
    // Compara o valor exato: arredondar antes (79,998% virando 80,0%) avisaria cedo.
    const fracao = d(c.consumo).div(c.planejado).times(100);
    const percentual = Number(fracao.toFixed(1));
    return [...LIMIARES_DO_ORCAMENTO]
      .reverse()
      .filter((l) => fracao.gte(l))
      .map((limiar) => {
        const chave = `orcamento:${mes}:${c.category_id}:${limiar}`;
        return {
          evento: EVENTO_ORCAMENTO_LIMITE,
          chave,
          payload: {
            chave,
            mes,
            category_id: c.category_id,
            categoria: c.nome,
            limiar,
            planejado: moeda(d(c.planejado)),
            consumo: moeda(d(c.consumo)),
            percentual,
          },
        };
      });
  });
}

/** Primeiro mes do fluxo projetado com saldo final negativo. */
export function saldoNegativo(meses: { mes: string; saldo_final: string }[]): Fato[] {
  const m = meses.slice(0, MESES_DO_FLUXO_VIGIADO).find((x) => d(x.saldo_final).lt(0));
  if (!m) return [];
  const chave = `saldo_negativo:${m.mes}`;
  return [
    {
      evento: EVENTO_SALDO_NEGATIVO,
      chave,
      payload: { chave, mes: m.mes, saldo_final: moeda(d(m.saldo_final)) },
    },
  ];
}

export interface ReceitaPrevista {
  id: string;
  descricao: string;
  valor: string;
  data: string;
}

/** Receita prevista com a data ja passada (um dia de atraso ja conta). */
export function receitasAtrasadas(previstas: ReceitaPrevista[], hoje: string): Fato[] {
  return previstas.flatMap((r) => {
    const atraso = dias(r.data, hoje);
    if (atraso < 1) return [];
    const chave = `receita_atrasada:${r.id}:${r.data}`;
    return [
      {
        evento: EVENTO_RECEITA_ATRASADA,
        chave,
        payload: {
          chave,
          transaction_id: r.id,
          descricao: r.descricao,
          valor: moeda(d(r.valor)),
          data: r.data,
          dias_de_atraso: atraso,
        },
      },
    ];
  });
}
