import { moeda } from "../decimal.js";
import { somarDias } from "../recorrencia.js";
import type {
  CategoriaDeInsight,
  Contexto,
  Insight,
  LancamentoDeInsight,
  Severidade,
} from "./tipos.js";
import { brl, despesaRealizada, diasEntre, idDeInsight, soma } from "./util.js";

/** Categorias de sistema (semeadas, nao se apagam): os insights contam com elas. */
export const CATEGORIAS_DE_TARIFA = new Set([
  "Tarifas bancárias",
  "Juros e encargos",
  "IOF",
]);

const PADRAO = /\b(ANUIDADE|TARIFA|PACOTE|JUROS|ENCARGOS?|MULTA|MORA|ROTATIVO|IOF)\b/;

export const TIPOS_DE_TARIFA = [
  "rotativo",
  "multa",
  "juros",
  "iof",
  "anuidade",
  "tarifa",
] as const;
export type TipoDeTarifa = (typeof TIPOS_DE_TARIFA)[number];

const ROTULO: Record<TipoDeTarifa, string> = {
  rotativo: "Juros do rotativo",
  multa: "Multa e mora por atraso",
  juros: "Juros e encargos",
  iof: "IOF",
  anuidade: "Anuidade",
  tarifa: "Tarifas e pacotes",
};

export function ehTarifa(
  l: LancamentoDeInsight,
  categorias: Map<string, CategoriaDeInsight>,
): boolean {
  if (l.tipo !== "despesa") return false;
  const cat = l.category_id ? categorias.get(l.category_id) : undefined;
  if (cat?.sistema && CATEGORIAS_DE_TARIFA.has(cat.nome)) return true;
  return PADRAO.test(l.descricao_normalizada);
}

/** Do mais grave ao mais comum: a primeira palavra que bate decide. */
export function tipoDeTarifa(
  l: LancamentoDeInsight,
  categorias: Map<string, CategoriaDeInsight>,
): TipoDeTarifa {
  const t = l.descricao_normalizada;
  if (/\bROTATIVO\b/.test(t)) return "rotativo";
  if (/\b(MULTA|MORA)\b/.test(t)) return "multa";
  if (/\bIOF\b/.test(t)) return "iof";
  if (/\bANUIDADE\b/.test(t)) return "anuidade";
  if (/\b(JUROS|ENCARGOS?)\b/.test(t)) return "juros";
  const nome = l.category_id ? categorias.get(l.category_id)?.nome : undefined;
  if (nome === "IOF") return "iof";
  if (nome === "Juros e encargos") return "juros";
  return "tarifa";
}

const DIAS_DE_NOVA = 60;

/**
 * Tarifas e juros dos ultimos 12 meses: categorias de sistema (Tarifas
 * bancarias, Juros e encargos, IOF) e descricoes com ANUIDADE, TARIFA, PACOTE,
 * JUROS, ENCARGO, MULTA, MORA, ROTATIVO ou IOF. Rotativo e multa em destaque.
 * Tarifa nova: descricao que aparece pela primeira vez nos ultimos 60 dias.
 */
export function tarifasEJuros(ctx: Contexto): Insight[] {
  const inicio = somarDias(ctx.hoje, -364);
  const todas = ctx.lancamentos.filter(
    (l) => despesaRealizada(l) && l.data <= ctx.hoje && ehTarifa(l, ctx.categorias),
  );
  const doAno = todas.filter((l) => l.data >= inicio);
  if (doAno.length === 0) return [];

  const porTipo = new Map<TipoDeTarifa, LancamentoDeInsight[]>();
  for (const l of doAno) {
    const t = tipoDeTarifa(l, ctx.categorias);
    porTipo.set(t, [...(porTipo.get(t) ?? []), l]);
  }
  const primeira = new Map<string, LancamentoDeInsight>();
  for (const l of [...todas].sort((a, b) => a.data.localeCompare(b.data)))
    if (!primeira.has(l.descricao_normalizada)) primeira.set(l.descricao_normalizada, l);
  const novas = [...primeira.values()]
    .filter((l) => diasEntre(l.data, ctx.hoje) <= DIAS_DE_NOVA)
    .map((l) => ({
      chave: l.descricao_normalizada,
      nome: l.descricao,
      valor: l.valor,
      data: l.data,
    }));

  const total = soma(doAno);
  const rotativo = soma(porTipo.get("rotativo") ?? []);
  const multa = soma(porTipo.get("multa") ?? []);
  const severidade: Severidade =
    rotativo.gt(0) || multa.gt(0) ? "alta" : total.gte(100) ? "media" : "baixa";
  const destaques = [
    rotativo.gt(0) && `${brl(rotativo)} de juros do rotativo`,
    multa.gt(0) && `${brl(multa)} de multa e mora por atraso`,
  ].filter(Boolean);
  return [
    {
      id: idDeInsight("tarifas", "12m"),
      tipo: "tarifas",
      titulo: `${brl(total)} em tarifas e juros em 12 meses`,
      descricao:
        `Foram ${doAno.length} cobranças de tarifas, juros, IOF e encargos nos últimos 12 meses` +
        (destaques.length ? `, incluindo ${destaques.join(" e ")}.` : ".") +
        (novas.length ? ` ${novas.length} cobrança(s) nova(s) nos últimos 60 dias.` : ""),
      impacto_mensal: moeda(total.div(12)),
      impacto_anual: moeda(total),
      severidade,
      evidencias: doAno.map((l) => l.id),
      acao_sugerida: rotativo.gt(0)
        ? "Saia do rotativo: pague a fatura inteira ou troque a dívida por um parcelamento com juros menores."
        : multa.gt(0)
          ? "Programe o pagamento das contas (débito automático ou lembrete) para não pagar multa e mora."
          : "Negocie o pacote de tarifas ou migre para uma conta e um cartão sem tarifa.",
      periodo: { inicio, fim: ctx.hoje },
      dados: {
        por_tipo: TIPOS_DE_TARIFA.filter((t) => porTipo.has(t)).map((t) => ({
          tipo: t,
          rotulo: ROTULO[t],
          valor: moeda(soma(porTipo.get(t)!)),
          lancamentos: porTipo.get(t)!.length,
        })),
        rotativo: moeda(rotativo),
        multa: moeda(multa),
        novas,
      },
    },
  ];
}
