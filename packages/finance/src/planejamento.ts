import { d, moeda } from "./decimal.js";
import { estadoDoOrcamento, type EstadoDoOrcamento } from "./orcamento.js";

/**
 * Planejamento mensal: o que se pretende receber e gastar por categoria,
 * comparado com o que aconteceu. Nao gera lancamento.
 */
export interface ItemPlanejado {
  category_id: string;
  /** Valor fechado do item. */
  valor: string;
  fixo: boolean;
  /** Percentual que e do usuario quando o custo e dividido; null: nao dividido. */
  parte_propria?: number | null;
}

/** Parte do usuario no valor fechado: o que entra no orcamento dele. */
export function valorProprio(valor: string, parte?: number | null): string {
  if (parte === null || parte === undefined) return moeda(d(valor));
  return moeda(d(valor).times(parte).div(100));
}

export interface MovimentoDaCategoria {
  category_id: string;
  realizado: string;
  previsto: string;
}

export interface CategoriaPlanejada {
  category_id: string;
  nome: string;
  natureza: "receita" | "despesa";
  planejado: string;
  fixo: string;
  realizado: string;
  previsto: string;
  /** Planejado menos realizado e previsto: quanto ainda cabe (negativo: estourou). */
  restante: string;
  consumo: string;
  estado: EstadoDoOrcamento;
}

export interface TotaisDoPlanejamento {
  receitas_planejadas: string;
  despesas_planejadas: string;
  despesas_fixas: string;
  despesas_variaveis: string;
  /** Receitas menos despesas planejadas. */
  sobra_planejada: string;
  receitas_realizadas: string;
  despesas_realizadas: string;
  /** Parte das despesas divididas que outra pessoa cobre (fora do orcamento). */
  despesas_de_terceiros: string;
}

export function compararPlanejamento(
  itens: ItemPlanejado[],
  movimentos: MovimentoDaCategoria[],
  categorias: Map<string, { nome: string; natureza: "receita" | "despesa" }>,
): { categorias: CategoriaPlanejada[]; totais: TotaisDoPlanejamento } {
  const linhas = new Map<
    string,
    {
      planejado: ReturnType<typeof d>;
      fixo: ReturnType<typeof d>;
      realizado: ReturnType<typeof d>;
      previsto: ReturnType<typeof d>;
    }
  >();
  const linha = (id: string) => {
    let l = linhas.get(id);
    if (!l) {
      l = { planejado: d(0), fixo: d(0), realizado: d(0), previsto: d(0) };
      linhas.set(id, l);
    }
    return l;
  };
  let terceiros = d(0);
  for (const i of itens) {
    const l = linha(i.category_id);
    const proprio = valorProprio(i.valor, i.parte_propria);
    l.planejado = l.planejado.plus(proprio);
    if (i.fixo) l.fixo = l.fixo.plus(proprio);
    if (categorias.get(i.category_id)?.natureza === "despesa")
      terceiros = terceiros.plus(d(i.valor).minus(proprio));
  }
  for (const m of movimentos) {
    const l = linha(m.category_id);
    l.realizado = l.realizado.plus(m.realizado);
    l.previsto = l.previsto.plus(m.previsto);
  }
  const t = {
    rp: d(0),
    dp: d(0),
    df: d(0),
    rr: d(0),
    dr: d(0),
  };
  const resultado: CategoriaPlanejada[] = [];
  for (const [id, l] of linhas) {
    const cat = categorias.get(id);
    if (!cat) continue;
    if (cat.natureza === "receita") {
      t.rp = t.rp.plus(l.planejado);
      t.rr = t.rr.plus(l.realizado);
    } else {
      t.dp = t.dp.plus(l.planejado);
      t.df = t.df.plus(l.fixo);
      t.dr = t.dr.plus(l.realizado);
    }
    resultado.push({
      category_id: id,
      nome: cat.nome,
      natureza: cat.natureza,
      planejado: moeda(l.planejado),
      fixo: moeda(l.fixo),
      realizado: moeda(l.realizado),
      previsto: moeda(l.previsto),
      restante: moeda(l.planejado.minus(l.realizado).minus(l.previsto)),
      consumo: moeda(l.realizado.plus(l.previsto)),
      estado:
        cat.natureza === "despesa"
          ? estadoDoOrcamento(moeda(l.planejado), moeda(l.realizado.plus(l.previsto)))
          : "ok",
    });
  }
  resultado.sort(
    (a, b) =>
      a.natureza.localeCompare(b.natureza) * -1 ||
      d(b.planejado).comparedTo(a.planejado) ||
      a.nome.localeCompare(b.nome),
  );
  return {
    categorias: resultado,
    totais: {
      receitas_planejadas: moeda(t.rp),
      despesas_planejadas: moeda(t.dp),
      despesas_fixas: moeda(t.df),
      despesas_variaveis: moeda(t.dp.minus(t.df)),
      sobra_planejada: moeda(t.rp.minus(t.dp)),
      receitas_realizadas: moeda(t.rr),
      despesas_realizadas: moeda(t.dr),
      despesas_de_terceiros: moeda(terceiros),
    },
  };
}
