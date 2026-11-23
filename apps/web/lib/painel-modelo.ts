import type { LancamentoFinanceiro } from "@bolsiq/assistant/puro";
import {
  comporPatrimonio,
  d,
  moeda,
  taxaDePoupanca,
  type PainelGeral,
  type PartesDoFinance,
  type PartesDoPortfolio,
} from "@bolsiq/finance/puro";
import type { PontoDoPatrimonio } from "@bolsiq/finance";

/**
 * Painel geral (ADR 0037), parte pura: recebe o que cada modulo devolveu e
 * monta a resposta. O BFF (`lib/painel.ts`) so busca.
 */

const gasto = (l: LancamentoFinanceiro) =>
  l.tipo === "despesa" && l.status === "realizado" && !l.aporte;

export function numerosDoMes(
  competencia: string,
  lancamentos: LancamentoFinanceiro[],
): PainelGeral["mes"] {
  const soma = (ls: LancamentoFinanceiro[]) => ls.reduce((s, l) => s.plus(l.valor), d(0));
  const renda = soma(
    lancamentos.filter((l) => l.tipo === "receita" && l.status === "realizado"),
  );
  const despesas = soma(lancamentos.filter(gasto));
  const investido = soma(lancamentos.filter((l) => l.aporte && l.status === "realizado"));
  return {
    competencia,
    renda: moeda(renda),
    despesas: moeda(despesas),
    taxa_de_poupanca: taxaDePoupanca(moeda(renda), moeda(despesas)),
    investido: moeda(investido),
  };
}

export interface EntradasDoPainel {
  hoje: string;
  financas: PartesDoFinance;
  portfolio: PartesDoPortfolio & { sem_cotacao: string[] };
  fotos: PontoDoPatrimonio[];
  lancamentosDoMes: LancamentoFinanceiro[];
  capacidade: {
    capacidade_mensal: string;
    sobra_media: string;
    meses_de_referencia: string[];
    compromissos_futuros: { aumento_por_mes: string };
    reserva_de_emergencia: { separar_por_mes: string };
  } | null;
  metas: PainelGeral["metas"];
}

export function montarPainel(e: EntradasDoPainel): PainelGeral {
  const patrimonio = comporPatrimonio(e.financas, e.portfolio);
  const competencia = e.hoje.slice(0, 7);
  // O mes corrente entra ao vivo no fim da serie; foto do mesmo mes (job
  // atrasado, por exemplo) da lugar ao valor de agora.
  const evolucao: PainelGeral["evolucao"] = [
    ...e.fotos
      .filter((f) => f.mes !== competencia)
      .map((f) => ({ ...f, parcial: false })),
    {
      mes: competencia,
      patrimonio_liquido: patrimonio.patrimonio_liquido,
      contas: patrimonio.contas,
      investimentos: moeda(
        d(patrimonio.renda_variavel).plus(patrimonio.renda_fixa).plus(patrimonio.fundos),
      ),
      dividas: patrimonio.passivos,
      parcial: true,
    },
  ];
  return {
    hoje: e.hoje,
    patrimonio,
    sem_cotacao: e.portfolio.sem_cotacao,
    evolucao,
    mes: numerosDoMes(competencia, e.lancamentosDoMes),
    capacidade: e.capacidade && {
      capacidade_mensal: e.capacidade.capacidade_mensal,
      sobra_media: e.capacidade.sobra_media,
      aumento_das_parcelas: e.capacidade.compromissos_futuros.aumento_por_mes,
      separar_para_reserva: e.capacidade.reserva_de_emergencia.separar_por_mes,
      meses_de_referencia: e.capacidade.meses_de_referencia,
    },
    metas: e.metas,
  };
}
