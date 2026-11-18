import { paraMoeda } from "./decimal.js";
import {
  cagr,
  derivar,
  endividamento,
  rentabilidade,
  valuation,
  type Endividamento,
  type Rentabilidade,
  type Valuation,
} from "./fundamentos.js";
import { bazin, graham, type PrecoJusto } from "./precoJusto.js";
import { desempenho, type Desempenho } from "./desempenho.js";
import type { DadosDeMercado, Demonstrativo, SerieDeRetornos } from "./tipos.js";

export interface Indicadores extends Valuation, Rentabilidade, Endividamento, Desempenho {
  reference_date: string;
  lpa: string | null;
  vpa: string | null;
  ebitda: string;
  cagr_receita_5a: number | null;
  cagr_lucro_5a: number | null;
  preco_graham: string | null;
  margem_graham: number | null;
  preco_bazin: string | null;
  margem_bazin: number | null;
}

export interface EntradaDeCalculo {
  demonstrativo: Demonstrativo;
  mercado: DadosDeMercado;
  /** Receita por ano, do mais antigo ao mais recente. Para o CAGR. */
  historico_receita?: string[];
  historico_lucro?: string[];
  retornos?: SerieDeRetornos;
  taxa_bazin?: number;
}

export function calcularIndicadores(entrada: EntradaDeCalculo): Indicadores {
  const { demonstrativo: dem, mercado: mkt } = entrada;
  const der = derivar(dem, mkt);

  const lpa = paraMoeda(der.lpa, 6);
  const vpa = paraMoeda(der.vpa, 6);

  const g: PrecoJusto = graham(lpa, vpa, mkt.preco);
  const b: PrecoJusto = bazin(mkt.proventos_por_ano ?? [], mkt.preco, entrada.taxa_bazin);

  return {
    reference_date: dem.reference_date,
    lpa,
    vpa,
    ebitda: paraMoeda(der.ebitda) ?? "0",
    ...valuation(dem, mkt, der),
    ...rentabilidade(dem, der),
    ...endividamento(dem, der),
    cagr_receita_5a: cagr(entrada.historico_receita ?? []),
    cagr_lucro_5a: cagr(entrada.historico_lucro ?? []),
    preco_graham: g.valor,
    margem_graham: g.margem_seguranca,
    preco_bazin: b.valor,
    margem_bazin: b.margem_seguranca,
    ...desempenho(entrada.retornos ?? { ativo: [] }),
  };
}
