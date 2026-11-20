import { d, moeda } from "./decimal.js";
import type { Sentido, StatusDeLancamento, TipoDeLancamento } from "./tipos.js";

/**
 * Numeros do dashboard do mes. Despesa e so compra e conta paga: o pagamento
 * da fatura e transferencia da conta para o cartao e nunca entra aqui, senao o
 * mesmo gasto contaria duas vezes (na compra e no pagamento).
 */
export interface LancamentoDoPainel {
  tipo: TipoDeLancamento;
  valor: string;
  status: StatusDeLancamento;
  category_id: string | null;
  transferencia_sentido: Sentido | null;
}

export interface CategoriaDoPainel {
  nome: string;
  tipo_custo: "fixo" | "variavel";
}

export interface NumerosDoMes {
  renda: { prevista: string; recebida: string };
  despesas: { pagas: string; a_pagar: string; total: string };
  fixos: { valor: string; percentual_da_renda: number | null };
  variaveis: { valor: string; percentual_da_renda: number | null };
  top_categorias: { category_id: string | null; nome: string; valor: string }[];
}

const realizado = (s: StatusDeLancamento) => s !== "previsto";

export function numerosDoMes(
  lancamentos: LancamentoDoPainel[],
  categorias: Map<string, CategoriaDoPainel>,
): NumerosDoMes {
  let rendaTotal = d(0);
  let rendaRecebida = d(0);
  let pagas = d(0);
  let aPagar = d(0);
  let fixos = d(0);
  let variaveis = d(0);
  const porCategoria = new Map<string | null, ReturnType<typeof d>>();
  for (const l of lancamentos) {
    if (l.tipo === "receita") {
      rendaTotal = rendaTotal.plus(l.valor);
      if (realizado(l.status)) rendaRecebida = rendaRecebida.plus(l.valor);
    }
    if (l.tipo !== "despesa") continue;
    if (realizado(l.status)) pagas = pagas.plus(l.valor);
    else aPagar = aPagar.plus(l.valor);
    const cat = l.category_id ? categorias.get(l.category_id) : undefined;
    if (cat?.tipo_custo === "fixo") fixos = fixos.plus(l.valor);
    else variaveis = variaveis.plus(l.valor);
    porCategoria.set(
      l.category_id,
      (porCategoria.get(l.category_id) ?? d(0)).plus(l.valor),
    );
  }
  const pct = (v: ReturnType<typeof d>) =>
    rendaTotal.isZero() ? null : Number(v.div(rendaTotal).times(100).toFixed(1));
  return {
    renda: { prevista: moeda(rendaTotal), recebida: moeda(rendaRecebida) },
    despesas: {
      pagas: moeda(pagas),
      a_pagar: moeda(aPagar),
      total: moeda(pagas.plus(aPagar)),
    },
    fixos: { valor: moeda(fixos), percentual_da_renda: pct(fixos) },
    variaveis: { valor: moeda(variaveis), percentual_da_renda: pct(variaveis) },
    top_categorias: [...porCategoria.entries()]
      .sort((a, b) => b[1].comparedTo(a[1]))
      .slice(0, 5)
      .map(([id, v]) => ({
        category_id: id,
        nome: id ? (categorias.get(id)?.nome ?? "Categoria") : "Sem categoria",
        valor: moeda(v),
      })),
  };
}
