import type { IndicadorFiltravel } from "./screener.js";

/**
 * Leitura de cada indicador em tres niveis, para a tela e para o assistente.
 *
 * As faixas sao referencias gerais de mercado (Graham, Bazin e as faixas usuais
 * de analise fundamentalista na B3), nao uma regra por setor: banco, seguradora
 * e utility tem faixas proprias. Ver ADR 0027.
 */
export type NivelDoSinal = "verde" | "amarelo" | "vermelho";

export interface Sinal {
  nivel: NivelDoSinal;
  leitura: string;
}

export interface AjudaDoIndicador {
  /** O que o indicador mede e como ler. */
  descricao: string;
  faixas: Record<NivelDoSinal, string>;
}

interface Regra {
  descricao: string;
  /** "menor": quanto menor, melhor. "maior": quanto maior, melhor. */
  sentido: "menor" | "maior";
  /** Limite do verde e do amarelo, no sentido da regra. */
  verde: number;
  amarelo: number;
  faixas: Record<NivelDoSinal, string>;
  /** Leitura propria para valor negativo (P/L com prejuizo, caixa liquido). */
  negativo?: Sinal;
}

const PREJUIZO: Sinal = {
  nivel: "vermelho",
  leitura: "negativo: a empresa teve prejuízo, o múltiplo não tem significado",
};
const CAIXA_LIQUIDO: Sinal = {
  nivel: "verde",
  leitura: "negativo: a empresa tem mais caixa que dívida (caixa líquido)",
};

export const REGRAS_DOS_SINAIS: Partial<Record<IndicadorFiltravel, Regra>> = {
  pl: {
    descricao:
      "Preço / lucro por ação: quantos anos de lucro atual pagam a ação. Menor é mais barato.",
    sentido: "menor",
    verde: 15,
    amarelo: 25,
    faixas: {
      verde: "até 15: barato, dentro do limite de Graham",
      amarelo: "de 15 a 25: preço moderado",
      vermelho: "acima de 25 ou negativo: caro, ou empresa com prejuízo",
    },
    negativo: PREJUIZO,
  },
  pvp: {
    descricao:
      "Preço / valor patrimonial por ação: quanto o mercado paga por real de patrimônio.",
    sentido: "menor",
    verde: 1.5,
    amarelo: 3,
    faixas: {
      verde: "até 1,5: barato, dentro do limite de Graham",
      amarelo: "de 1,5 a 3: preço moderado",
      vermelho: "acima de 3 ou negativo: caro, ou patrimônio negativo",
    },
    negativo: { nivel: "vermelho", leitura: "negativo: patrimônio líquido negativo" },
  },
  ev_ebitda: {
    descricao:
      "Valor da firma (mercado + dívida líquida) / EBITDA: considera a dívida, compara empresas alavancadas e não alavancadas.",
    sentido: "menor",
    verde: 6,
    amarelo: 10,
    faixas: {
      verde: "até 6: barato",
      amarelo: "de 6 a 10: preço moderado",
      vermelho: "acima de 10 ou negativo: caro, ou EBITDA negativo",
    },
    negativo: { nivel: "vermelho", leitura: "negativo: EBITDA negativo" },
  },
  ev_ebit: {
    descricao: "Valor da firma / EBIT: como o EV/EBITDA, mas desconta a depreciação.",
    sentido: "menor",
    verde: 8,
    amarelo: 12,
    faixas: {
      verde: "até 8: barato",
      amarelo: "de 8 a 12: preço moderado",
      vermelho: "acima de 12 ou negativo: caro, ou EBIT negativo",
    },
    negativo: { nivel: "vermelho", leitura: "negativo: EBIT negativo" },
  },
  p_receita: {
    descricao: "Preço / receita por ação (PSR). Útil quando o lucro é instável.",
    sentido: "menor",
    verde: 1,
    amarelo: 3,
    faixas: {
      verde: "até 1: barato",
      amarelo: "de 1 a 3: preço moderado",
      vermelho: "acima de 3: caro para a receita",
    },
  },
  dy_12m: {
    descricao: "Dividend yield: proventos dos últimos 12 meses / preço.",
    sentido: "maior",
    verde: 0.06,
    amarelo: 0.03,
    faixas: {
      verde: "6% ou mais: bom pagador, no critério de Bazin",
      amarelo: "de 3% a 6%: pagamento moderado",
      vermelho: "abaixo de 3%: paga pouco (pode estar reinvestindo o lucro)",
    },
  },
  dy_medio_5a: {
    descricao: "Dividend yield médio dos últimos 5 anos: mostra a consistência.",
    sentido: "maior",
    verde: 0.06,
    amarelo: 0.03,
    faixas: {
      verde: "6% ou mais: pagamento alto e consistente",
      amarelo: "de 3% a 6%: pagamento moderado",
      vermelho: "abaixo de 3%: paga pouco",
    },
  },
  roe: {
    descricao: "Retorno sobre o patrimônio: lucro / patrimônio líquido.",
    sentido: "maior",
    verde: 0.15,
    amarelo: 0.08,
    faixas: {
      verde: "15% ou mais: rentabilidade alta",
      amarelo: "de 8% a 15%: rentabilidade moderada",
      vermelho: "abaixo de 8%: rentabilidade baixa",
    },
  },
  roic: {
    descricao: "Retorno sobre o capital investido (próprio e de terceiros).",
    sentido: "maior",
    verde: 0.12,
    amarelo: 0.06,
    faixas: {
      verde: "12% ou mais: cria valor",
      amarelo: "de 6% a 12%: retorno moderado",
      vermelho: "abaixo de 6%: retorno baixo",
    },
  },
  roa: {
    descricao:
      "Retorno sobre os ativos: lucro / ativo total. Banco tem ROA baixo por natureza.",
    sentido: "maior",
    verde: 0.07,
    amarelo: 0.03,
    faixas: {
      verde: "7% ou mais: ativos bem aproveitados",
      amarelo: "de 3% a 7%: moderado",
      vermelho: "abaixo de 3%: baixo",
    },
  },
  margem_bruta: {
    descricao: "Resultado bruto / receita.",
    sentido: "maior",
    verde: 0.4,
    amarelo: 0.2,
    faixas: {
      verde: "40% ou mais: margem alta",
      amarelo: "de 20% a 40%: moderada",
      vermelho: "abaixo de 20%: margem apertada",
    },
  },
  margem_ebitda: {
    descricao: "EBITDA / receita: geração de caixa operacional.",
    sentido: "maior",
    verde: 0.2,
    amarelo: 0.1,
    faixas: {
      verde: "20% ou mais: margem alta",
      amarelo: "de 10% a 20%: moderada",
      vermelho: "abaixo de 10%: margem apertada",
    },
  },
  margem_liquida: {
    descricao: "Lucro líquido / receita.",
    sentido: "maior",
    verde: 0.1,
    amarelo: 0.05,
    faixas: {
      verde: "10% ou mais: margem alta",
      amarelo: "de 5% a 10%: moderada",
      vermelho: "abaixo de 5%: margem apertada",
    },
  },
  dl_ebitda: {
    descricao:
      "Dívida líquida / EBITDA: em quantos anos a geração de caixa paga a dívida.",
    sentido: "menor",
    verde: 2,
    amarelo: 3.5,
    faixas: {
      verde: "até 2 (ou negativo, caixa líquido): endividamento baixo",
      amarelo: "de 2 a 3,5: endividamento moderado",
      vermelho: "acima de 3,5: endividamento alto",
    },
    negativo: CAIXA_LIQUIDO,
  },
  dl_pl: {
    descricao: "Dívida líquida / patrimônio líquido.",
    sentido: "menor",
    verde: 0.5,
    amarelo: 1,
    faixas: {
      verde: "até 0,5 (ou negativo, caixa líquido): endividamento baixo",
      amarelo: "de 0,5 a 1: moderado",
      vermelho: "acima de 1: dívida maior que o patrimônio",
    },
    negativo: CAIXA_LIQUIDO,
  },
  liquidez_corrente: {
    descricao: "Ativo circulante / passivo circulante: folga para pagar o curto prazo.",
    sentido: "maior",
    verde: 1.5,
    amarelo: 1,
    faixas: {
      verde: "1,5 ou mais: folga confortável",
      amarelo: "de 1 a 1,5: folga apertada",
      vermelho: "abaixo de 1: obrigações de curto prazo maiores que o ativo circulante",
    },
  },
  cagr_receita_5a: {
    descricao: "Crescimento anual composto da receita em 5 anos.",
    sentido: "maior",
    verde: 0.1,
    amarelo: 0,
    faixas: {
      verde: "10% ao ano ou mais: crescimento forte",
      amarelo: "de 0% a 10% ao ano: crescimento moderado",
      vermelho: "negativo: receita encolhendo",
    },
  },
  cagr_lucro_5a: {
    descricao: "Crescimento anual composto do lucro em 5 anos.",
    sentido: "maior",
    verde: 0.1,
    amarelo: 0,
    faixas: {
      verde: "10% ao ano ou mais: crescimento forte",
      amarelo: "de 0% a 10% ao ano: crescimento moderado",
      vermelho: "negativo: lucro encolhendo",
    },
  },
  margem_graham: {
    descricao:
      "Margem de segurança sobre o preço justo de Graham, raiz de 22,5 x LPA x VPA. Preço abaixo do justo é desconto.",
    sentido: "maior",
    verde: 0.2,
    amarelo: 0,
    faixas: {
      verde: "preço 20% ou mais abaixo do justo: o método de Graham indica compra",
      amarelo: "preço abaixo do justo, com margem menor que 20%: desconto pequeno",
      vermelho: "preço acima do justo: caro pelo método de Graham",
    },
  },
  margem_bazin: {
    descricao:
      "Margem sobre o preço-teto de Bazin: dividendo médio de 5 anos / 6%. Preço abaixo do teto é desconto.",
    sentido: "maior",
    verde: 0,
    amarelo: -0.1,
    faixas: {
      verde: "preço no teto ou abaixo: o método de Bazin indica compra",
      amarelo: "preço até 10% acima do teto: perto do limite",
      vermelho: "preço mais de 10% acima do teto: caro pelo método de Bazin",
    },
  },
  volatilidade_anual: {
    descricao: "Desvio-padrão anualizado dos retornos diários: quanto o preço oscila.",
    sentido: "menor",
    verde: 0.25,
    amarelo: 0.4,
    faixas: {
      verde: "até 25%: oscilação baixa",
      amarelo: "de 25% a 40%: oscilação moderada",
      vermelho: "acima de 40%: oscilação alta",
    },
  },
  drawdown_maximo: {
    descricao: "Maior queda do pico ao fundo no período.",
    sentido: "maior",
    verde: -0.2,
    amarelo: -0.4,
    faixas: {
      verde: "queda máxima de até 20%",
      amarelo: "queda máxima de 20% a 40%",
      vermelho: "queda máxima acima de 40%",
    },
  },
  sharpe: {
    descricao: "Retorno acima do CDI por unidade de risco.",
    sentido: "maior",
    verde: 1,
    amarelo: 0,
    faixas: {
      verde: "1 ou mais: retorno compensa o risco",
      amarelo: "de 0 a 1: rendeu acima do CDI, mas pouco para o risco",
      vermelho: "negativo: rendeu menos que o CDI",
    },
  },
  beta: {
    descricao: "Sensibilidade ao IBOV: 1 acompanha o índice, acima de 1 amplifica.",
    sentido: "menor",
    verde: 0.8,
    amarelo: 1.2,
    faixas: {
      verde: "até 0,8: defensivo, oscila menos que o mercado",
      amarelo: "de 0,8 a 1,2: acompanha o mercado",
      vermelho: "acima de 1,2: oscila mais que o mercado",
    },
  },
  liquidez_diaria: {
    descricao: "Volume financeiro médio negociado por dia.",
    sentido: "maior",
    verde: 10_000_000,
    amarelo: 1_000_000,
    faixas: {
      verde: "R$ 10 milhões ou mais: entra e sai com facilidade",
      amarelo: "de R$ 1 milhão a R$ 10 milhões: liquidez moderada",
      vermelho: "abaixo de R$ 1 milhão: pode ser difícil comprar ou vender",
    },
  },
};

export function ajudaDoIndicador(nome: IndicadorFiltravel): AjudaDoIndicador | null {
  const r = REGRAS_DOS_SINAIS[nome];
  return r ? { descricao: r.descricao, faixas: r.faixas } : null;
}

export function avaliarIndicador(
  nome: IndicadorFiltravel,
  valor: number | null | undefined,
): Sinal | null {
  const r = REGRAS_DOS_SINAIS[nome];
  if (!r || valor === null || valor === undefined || !Number.isFinite(valor)) return null;
  if (r.negativo && valor < 0) return r.negativo;
  const nivel: NivelDoSinal =
    r.sentido === "menor"
      ? valor <= r.verde
        ? "verde"
        : valor <= r.amarelo
          ? "amarelo"
          : "vermelho"
      : valor >= r.verde
        ? "verde"
        : valor >= r.amarelo
          ? "amarelo"
          : "vermelho";
  return { nivel, leitura: r.faixas[nivel] };
}

/** Sinal de cada indicador com valor e regra; os demais ficam de fora. */
export function avaliarIndicadores(
  valores: Partial<Record<IndicadorFiltravel, number | null>>,
): Partial<Record<IndicadorFiltravel, Sinal>> {
  const saida: Partial<Record<IndicadorFiltravel, Sinal>> = {};
  for (const [nome, valor] of Object.entries(valores)) {
    const s = avaliarIndicador(nome as IndicadorFiltravel, valor);
    if (s) saida[nome as IndicadorFiltravel] = s;
  }
  return saida;
}
