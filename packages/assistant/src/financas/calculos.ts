import {
  d,
  dividirTotal,
  estadoDoOrcamento,
  moeda,
  normalizarDescricao,
} from "@bolsiq/finance/puro";
import { anonimizarDescricao } from "./anonimizar.js";
import type {
  FluxoFinanceiro,
  InsightFinanceiro,
  LancamentoFinanceiro,
  ResumoDoMes,
} from "./tipos.js";

/**
 * Calculos das ferramentas financeiras: puros, sem modelo. A ferramenta so
 * busca o dado e chama daqui; o modelo explica o resultado.
 */

const SEM_CATEGORIA = "Sem categoria";
const realizado = (l: LancamentoFinanceiro) => l.status !== "previsto";

/** Gasto de consumo: despesa realizada, sem aporte (aporte e poupanca). */
export const ehGasto = (l: LancamentoFinanceiro) =>
  l.tipo === "despesa" && realizado(l) && !l.aporte;
const ehRenda = (l: LancamentoFinanceiro) => l.tipo === "receita" && realizado(l);

const soma = (ls: LancamentoFinanceiro[]) => ls.reduce((s, l) => s.plus(l.valor), d(0));
const pct = (parte: ReturnType<typeof d>, total: ReturnType<typeof d>) =>
  total.isZero() ? null : Number(parte.div(total).times(100).toFixed(1));

export interface GastoDaCategoria {
  categoria: string;
  valor: string;
  percentual: number | null;
  lancamentos: number;
  essencial: boolean;
}

function porCategoria(ls: LancamentoFinanceiro[]) {
  const m = new Map<
    string,
    { valor: ReturnType<typeof d>; n: number; essencial: boolean }
  >();
  for (const l of ls.filter(ehGasto)) {
    const c = l.categoria ?? SEM_CATEGORIA;
    const a = m.get(c) ?? { valor: d(0), n: 0, essencial: l.essencial };
    m.set(c, { valor: a.valor.plus(l.valor), n: a.n + 1, essencial: a.essencial });
  }
  return m;
}

/** Gastos do periodo por categoria, do maior para o menor; o resto soma em "outras". */
export function gastosPorCategoria(ls: LancamentoFinanceiro[], top: number) {
  const m = porCategoria(ls);
  const total = [...m.values()].reduce((s, c) => s.plus(c.valor), d(0));
  const todas: GastoDaCategoria[] = [...m.entries()]
    .sort((a, b) => b[1].valor.comparedTo(a[1].valor) || a[0].localeCompare(b[0]))
    .map(([categoria, c]) => ({
      categoria,
      valor: moeda(c.valor),
      percentual: pct(c.valor, total),
      lancamentos: c.n,
      essencial: c.essencial,
    }));
  const resto = todas.slice(top);
  return {
    total: moeda(total),
    categorias: todas.slice(0, top),
    outras:
      resto.length === 0
        ? null
        : {
            categorias: resto.length,
            valor: moeda(resto.reduce((s, c) => s.plus(c.valor), d(0))),
          },
  };
}

/** Variacao por categoria de `a` para `b`, da maior mudanca (em reais) para a menor. */
export function compararMeses(
  a: { mes: string; lancamentos: LancamentoFinanceiro[] },
  b: { mes: string; lancamentos: LancamentoFinanceiro[] },
  limite = 15,
) {
  const ma = porCategoria(a.lancamentos);
  const mb = porCategoria(b.lancamentos);
  const nomes = [...new Set([...ma.keys(), ...mb.keys()])];
  const linhas = nomes
    .map((categoria) => {
      const va = ma.get(categoria)?.valor ?? d(0);
      const vb = mb.get(categoria)?.valor ?? d(0);
      return { categoria, va, vb, delta: vb.minus(va) };
    })
    .sort(
      (x, y) =>
        y.delta.abs().comparedTo(x.delta.abs()) || x.categoria.localeCompare(y.categoria),
    );
  const ta = soma(a.lancamentos.filter(ehGasto));
  const tb = soma(b.lancamentos.filter(ehGasto));
  return {
    a: {
      mes: a.mes,
      gastos: moeda(ta),
      renda: moeda(soma(a.lancamentos.filter(ehRenda))),
    },
    b: {
      mes: b.mes,
      gastos: moeda(tb),
      renda: moeda(soma(b.lancamentos.filter(ehRenda))),
    },
    variacao: moeda(tb.minus(ta)),
    variacao_percentual: pct(tb.minus(ta), ta),
    categorias: linhas.slice(0, limite).map((l) => ({
      categoria: l.categoria,
      [a.mes]: moeda(l.va),
      [b.mes]: moeda(l.vb),
      variacao: moeda(l.delta),
      variacao_percentual: pct(l.delta, l.va),
    })),
    categorias_omitidas: Math.max(0, linhas.length - limite),
  };
}

const igual = (a: string, b: string) => normalizarDescricao(a) === normalizarDescricao(b);

export interface FiltroDaBusca {
  busca?: string | undefined;
  categoria?: string | undefined;
  tipo?: "despesa" | "receita" | undefined;
  limite: number;
}

/**
 * Lancamentos que casam com a busca (descricao sem acento e sem caixa) e a
 * categoria. Soma tudo o que casou, nao so as linhas mostradas. A descricao sai
 * anonimizada (PIX e transferencia).
 */
export function filtrarLancamentos(ls: LancamentoFinanceiro[], f: FiltroDaBusca) {
  const termo = f.busca ? normalizarDescricao(f.busca) : "";
  const casou = ls
    .filter((l) => l.tipo !== "transferencia")
    .filter((l) => !f.tipo || l.tipo === f.tipo)
    .filter((l) => !termo || normalizarDescricao(l.descricao).includes(termo))
    .filter((l) => !f.categoria || igual(l.categoria ?? SEM_CATEGORIA, f.categoria))
    .sort((a, b) => b.data.localeCompare(a.data) || a.id.localeCompare(b.id));
  const despesas = casou.filter((l) => l.tipo === "despesa");
  const receitas = casou.filter((l) => l.tipo === "receita");
  return {
    quantidade: casou.length,
    soma_despesas: moeda(soma(despesas)),
    soma_receitas: moeda(soma(receitas)),
    lancamentos: casou.slice(0, f.limite).map((l) => ({
      data: l.data,
      descricao: anonimizarDescricao(l.descricao),
      valor: l.valor,
      tipo: l.tipo,
      status: l.status,
      categoria: l.categoria ?? SEM_CATEGORIA,
      origem: l.origem,
    })),
    mostrando: Math.min(f.limite, casou.length),
  };
}

/** Quanto de cada tipo de insight vira economia recorrente. */
const FRACAO_DO_CORTE: Record<string, { fracao: number; acao: string }> = {
  assinatura: { fracao: 1, acao: "cancelar" },
  formiga: { fracao: 0.5, acao: "reduzir pela metade" },
  tarifas: { fracao: 1, acao: "trocar por conta sem tarifa e sair do rotativo" },
};

/**
 * Cortes que atingem `meta` por mes com o menor impacto em essenciais: primeiro
 * os nao essenciais, do que mais economiza para o que menos (menos cortes),
 * depois os essenciais, so se faltar. Gasto pontual (fora do padrao, compra
 * atipica) nao entra: nao se repete, entao nao e economia mensal.
 */
export function cortesPossiveis(insights: InsightFinanceiro[]) {
  return insights
    .flatMap((i) => {
      const regra = FRACAO_DO_CORTE[i.tipo];
      if (!regra) return [];
      const economia = d(i.impacto_mensal).times(regra.fracao).toDecimalPlaces(2);
      return economia.gt(0) ? [{ i, regra, economia }] : [];
    })
    .sort(
      (a, b) =>
        Number(a.i.essencial) - Number(b.i.essencial) ||
        b.economia.comparedTo(a.economia) ||
        a.i.id.localeCompare(b.i.id),
    );
}

export function sugerirCortes(insights: InsightFinanceiro[], meta: string) {
  const candidatos = cortesPossiveis(insights);
  const alvo = d(meta);
  const escolhidos: typeof candidatos = [];
  let total = d(0);
  for (const c of candidatos) {
    if (total.gte(alvo)) break;
    escolhidos.push(c);
    total = total.plus(c.economia);
  }
  return {
    meta_mensal: moeda(alvo),
    cortes: escolhidos.map(({ i, regra, economia }) => ({
      insight_id: i.id,
      tipo: i.tipo,
      titulo: i.titulo,
      acao: regra.acao,
      economia_mensal: moeda(economia),
      economia_anual: moeda(economia.times(12)),
      essencial: i.essencial,
    })),
    economia_mensal: moeda(total),
    economia_anual: moeda(total.times(12)),
    atinge_a_meta: total.gte(alvo),
    falta: moeda(alvo.minus(total).gt(0) ? alvo.minus(total) : d(0)),
    usa_essenciais: escolhidos.some((c) => c.i.essencial),
    candidatos_nao_usados: candidatos.length - escolhidos.length,
    link: "/financas/insights/simulador",
  };
}

/** Teto de parcelas sobre a renda prevista: acima disso a compra fica "apertada". */
export const COMPROMETIMENTO_MAXIMO = 30;

/**
 * Compra parcelada contra o fluxo projetado e o orcamento. As parcelas caem a
 * partir do mes seguinte (proxima fatura), uma por mes. O orcamento de
 * referencia e o do mes atual: a primeira parcela entra nele como se ja fosse
 * gasto, para ver se estoura.
 */
export function simularCompra(o: {
  valor: string;
  parcelas: number;
  fluxo: FluxoFinanceiro;
  resumo: ResumoDoMes;
}) {
  const valores = dividirTotal(d(o.valor).toFixed(2), o.parcelas);
  // O centavo do arredondamento vai na primeira (dividirTotal).
  const primeira = valores[0] as string;
  const parcela = valores.at(-1) as string;
  let acumulado = d(0);
  const meses = o.fluxo.meses.map((m, i) => {
    const desta = i >= 1 && i <= valores.length ? d(valores[i - 1] as string) : d(0);
    acumulado = acumulado.plus(desta);
    return {
      mes: m.mes,
      parcela: moeda(desta),
      saldo_sem_a_compra: m.saldo_final,
      saldo_com_a_compra: moeda(d(m.saldo_final).minus(acumulado)),
    };
  });
  const negativoAntes = o.fluxo.primeiro_mes_negativo;
  const negativoDepois = meses.find((m) => d(m.saldo_com_a_compra).lt(0))?.mes ?? null;
  const menor = meses.reduce(
    (m, x) => (d(x.saldo_com_a_compra).lt(m.saldo_com_a_compra) ? x : m),
    meses[0] as (typeof meses)[number],
  );

  const orc = o.resumo.orcamento;
  const consumo = d(orc.consumo).plus(primeira);
  const estado = d(orc.planejado).isZero()
    ? null
    : estadoDoOrcamento(orc.planejado, moeda(consumo));
  const renda = d(o.resumo.renda.prevista);
  const parcelasDoMes = d(o.resumo.comprometido_parcelas).plus(primeira);
  const comprometimento = pct(parcelasDoMes, renda);

  const motivos: string[] = [];
  if (negativoDepois && !negativoAntes) motivos.push("saldo_negativo_com_a_compra");
  if (negativoAntes) motivos.push("saldo_ja_fica_negativo_sem_a_compra");
  if (estado === "estourado" && orc.estado !== "estourado")
    motivos.push("estoura_o_orcamento");
  if (comprometimento !== null && comprometimento > COMPROMETIMENTO_MAXIMO)
    motivos.push("parcelas_acima_de_30_por_cento_da_renda");
  const veredito = negativoDepois ? "nao_cabe" : motivos.length > 0 ? "apertado" : "cabe";

  return {
    veredito,
    motivos,
    valor: moeda(d(o.valor)),
    parcelas: o.parcelas,
    valor_da_parcela: parcela,
    ...(primeira !== parcela ? { primeira_parcela: primeira } : {}),
    primeiro_mes_negativo_sem_a_compra: negativoAntes,
    primeiro_mes_negativo_com_a_compra: negativoDepois,
    menor_saldo_com_a_compra: menor
      ? { mes: menor.mes, saldo: menor.saldo_com_a_compra }
      : null,
    orcamento_de_referencia: {
      competencia: o.resumo.competencia,
      planejado: orc.planejado,
      consumo_atual: orc.consumo,
      consumo_com_a_parcela: moeda(consumo),
      estado_atual: orc.estado,
      estado_com_a_parcela: estado,
    },
    parcelas_sobre_a_renda: {
      renda_prevista: o.resumo.renda.prevista,
      parcelas_do_mes_com_a_compra: moeda(parcelasDoMes),
      percentual: comprometimento,
      teto: COMPROMETIMENTO_MAXIMO,
    },
    meses,
    link: "/financas/fluxo",
  };
}

/** Reserva de emergencia: meses de despesas essenciais. */
export const MESES_DE_RESERVA = 6;
/** Em quantos meses a sobra completa a reserva que falta. */
export const MESES_PARA_COMPLETAR_RESERVA = 12;

/**
 * Quanto da para investir por mes: sobra media dos 3 meses completos
 * anteriores, menos o aumento das parcelas que vem (o que ja era parcela esta
 * dentro da sobra), menos a parte que completa a reserva de emergencia
 * (6 meses de essenciais, em 12 meses).
 */
export function capacidadeDeAporte(o: {
  meses: string[];
  lancamentos: LancamentoFinanceiro[];
  parcelas_futuras: { mes: string; total: string }[];
  saldo_em_conta: string;
}) {
  const n = o.meses.length;
  const media = (v: ReturnType<typeof d>) => v.div(n).toDecimalPlaces(2);
  const gastos = o.lancamentos.filter(ehGasto);
  const renda = media(soma(o.lancamentos.filter(ehRenda)));
  const despesa = media(soma(gastos));
  const sobra = renda.minus(despesa);
  const essenciais = media(soma(gastos.filter((l) => l.essencial)));
  const parcelasPagas = media(soma(gastos.filter((l) => l.parcela)));
  const proximas = o.parcelas_futuras.slice(0, 3);
  const parcelasQueVem = proximas.length
    ? proximas
        .reduce((s, m) => s.plus(m.total), d(0))
        .div(proximas.length)
        .toDecimalPlaces(2)
    : d(0);
  const aumento = parcelasQueVem.minus(parcelasPagas);
  const compromisso = aumento.gt(0) ? aumento : d(0);
  const alvo = essenciais.times(MESES_DE_RESERVA);
  const falta = alvo.minus(o.saldo_em_conta);
  const reserva = falta.gt(0)
    ? falta.div(MESES_PARA_COMPLETAR_RESERVA).toDecimalPlaces(2)
    : d(0);
  const livre = sobra.minus(compromisso).minus(reserva);
  const capacidade = livre.gt(0) ? livre : d(0);
  return {
    meses_de_referencia: o.meses,
    renda_media: moeda(renda),
    despesa_media: moeda(despesa),
    sobra_media: moeda(sobra),
    compromissos_futuros: {
      parcelas_pagas_por_mes: moeda(parcelasPagas),
      parcelas_dos_proximos_meses: moeda(parcelasQueVem),
      aumento_por_mes: moeda(compromisso),
    },
    reserva_de_emergencia: {
      meses: MESES_DE_RESERVA,
      essenciais_por_mes: moeda(essenciais),
      alvo: moeda(alvo),
      saldo_em_conta: moeda(d(o.saldo_em_conta)),
      falta: moeda(falta.gt(0) ? falta : d(0)),
      separar_por_mes: moeda(reserva),
    },
    capacidade_mensal: moeda(capacidade),
    proximo_passo: capacidade.gt(0)
      ? `Para escolher onde investir, chame sugerir_aporte com valor ${capacidade.toFixed(2)}.`
      : "Sem sobra para investir agora: veja sugerir_cortes.",
  };
}
