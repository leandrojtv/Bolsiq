import type { Decimal } from "decimal.js";
import { d, moeda } from "../decimal.js";
import { somarDias } from "../recorrencia.js";
import { ehTarifa } from "./tarifas.js";
import type { Contexto, Insight, LancamentoDeInsight, Severidade } from "./tipos.js";
import { brl, despesaRealizada, diasEntre, idDeInsight } from "./util.js";

export type FrequenciaDeAssinatura = "mensal" | "anual";

export interface Assinatura {
  id: string;
  chave: string;
  nome: string;
  frequencia: FrequenciaDeAssinatura;
  valor_atual: string;
  /** Equivalente mensal (a anual dividida por 12). */
  valor_mensal: string;
  valor_anual: string;
  ocorrencias: number;
  primeira: string;
  ultima: string;
  proxima: string;
  category_id: string | null;
  categoria: string | null;
  /** Rotulo do grupo da duplicidade (servico ou categoria), quando ha. */
  grupo: string | null;
  reajuste: { de: string; para: string; percentual: number } | null;
  /** ids das outras assinaturas do mesmo grupo. */
  duplicidade: string[];
  nova: boolean;
  account_id: string | null;
  card_id: string | null;
  evidencias: string[];
}

const REGRAS = {
  mensal: { min: 28, max: 35, ocorrencias: 3, folga: 45 },
  anual: { min: 360, max: 370, ocorrencias: 2, folga: 380 },
} as const;

/** Variacao entre cobrancas seguidas; um unico degrau maior e o reajuste. */
const VARIACAO = 0.1;
const DEGRAU_DE_REAJUSTE = 0.3;
const DIAS_DE_NOVA = 60;

/** Categorias genericas: ter duas nelas nao diz nada sobre duplicidade. */
const GENERICAS = new Set(["Assinaturas", "Outros"]);

const SERVICOS: [string, RegExp][] = [
  [
    "streaming de vídeo",
    /\b(NETFLIX|PRIME VIDEO|AMAZON PRIME|DISNEY|HBO|MAX|GLOBOPLAY|PARAMOUNT|APPLE TV|CRUNCHYROLL|MUBI|TELECINE|YOUTUBE PREMIUM)\b/,
  ],
  ["música", /\b(SPOTIFY|DEEZER|YOUTUBE MUSIC|APPLE MUSIC|TIDAL|AMAZON MUSIC)\b/],
  ["armazenamento na nuvem", /\b(ICLOUD|GOOGLE ONE|DROPBOX|ONEDRIVE|MICROSOFT 365)\b/],
];

export function servicoDe(descricaoNormalizada: string): string | null {
  for (const [nome, re] of SERVICOS) if (re.test(descricaoNormalizada)) return nome;
  return null;
}

/**
 * Cadeia periodica que termina na ultima cobranca: anda para tras aceitando a
 * anterior so se o intervalo e a variacao de valor cabem. Qualquer cobranca
 * fora do ritmo (dois cafes no mesmo dia, uma compra avulsa) quebra a cadeia.
 */
function cadeia(
  ls: LancamentoDeInsight[],
  freq: FrequenciaDeAssinatura,
): LancamentoDeInsight[] {
  const r = REGRAS[freq];
  const c = [ls.at(-1)!];
  let degraus = 0;
  for (let i = ls.length - 2; i >= 0; i--) {
    const anterior = ls[i]!;
    const seguinte = c[0]!;
    const gap = diasEntre(anterior.data, seguinte.data);
    if (gap < r.min || gap > r.max) break;
    const variacao = d(seguinte.valor).minus(anterior.valor).div(anterior.valor);
    if (variacao.abs().lte(VARIACAO)) c.unshift(anterior);
    else if (degraus === 0 && variacao.gt(0) && variacao.lte(DEGRAU_DE_REAJUSTE)) {
      degraus++;
      c.unshift(anterior);
    } else break;
  }
  return c;
}

/**
 * Assinaturas: mesma descricao normalizada (o estabelecimento), valor com
 * variacao ate 10% e intervalo de 28 a 35 dias (mensal, 3 cobrancas ou mais)
 * ou de 360 a 370 (anual, 2 ou mais). Fica de fora: tarifa (vai para tarifas),
 * parcela e gasto fixo essencial (aluguel, escola), que nao se corta como
 * assinatura. So as ativas: a ultima cobranca dentro do ciclo mais uma folga.
 */
export function detectarAssinaturas(ctx: Contexto): Assinatura[] {
  const porChave = new Map<string, LancamentoDeInsight[]>();
  for (const l of ctx.lancamentos) {
    if (!despesaRealizada(l) || l.parcelado || l.data > ctx.hoje) continue;
    if (ehTarifa(l, ctx.categorias)) continue;
    if (l.category_id && ctx.categorias.get(l.category_id)?.essencial) continue;
    const g = porChave.get(l.descricao_normalizada) ?? [];
    g.push(l);
    porChave.set(l.descricao_normalizada, g);
  }
  const achadas: Assinatura[] = [];
  for (const [chave, todas] of porChave) {
    const ls = todas.sort(
      (a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id),
    );
    for (const freq of ["mensal", "anual"] as const) {
      const r = REGRAS[freq];
      const c = cadeia(ls, freq);
      if (c.length < r.ocorrencias) continue;
      const ultima = c.at(-1)!;
      if (diasEntre(ultima.data, ctx.hoje) > r.folga) break;
      achadas.push(montar(chave, ls, c, freq, ctx));
      break;
    }
  }
  marcarDuplicidade(achadas);
  return achadas.sort(
    (a, b) =>
      d(b.valor_anual).comparedTo(a.valor_anual) || a.chave.localeCompare(b.chave),
  );
}

function montar(
  chave: string,
  todas: LancamentoDeInsight[],
  c: LancamentoDeInsight[],
  freq: FrequenciaDeAssinatura,
  ctx: Contexto,
): Assinatura {
  const ultima = c.at(-1)!;
  const atual = d(ultima.valor);
  const anteriores = c.slice(0, -1);
  const media = anteriores
    .reduce((s, l) => s.plus(l.valor), d(0) as Decimal)
    .div(anteriores.length)
    .toDecimalPlaces(2);
  const reajuste = atual.gt(media)
    ? {
        de: moeda(media),
        para: moeda(atual),
        percentual: Number(atual.minus(media).div(media).times(100).toFixed(1)),
      }
    : null;
  const minimo = c[REGRAS[freq].ocorrencias - 1]!;
  const cat = ultima.category_id ? ctx.categorias.get(ultima.category_id) : undefined;
  const mensal = freq === "mensal" ? atual : atual.div(12);
  return {
    id: idDeInsight("assinatura", chave),
    chave,
    nome: ultima.descricao,
    frequencia: freq,
    valor_atual: moeda(atual),
    valor_mensal: moeda(mensal),
    valor_anual: moeda(freq === "mensal" ? atual.times(12) : atual),
    ocorrencias: c.length,
    primeira: c[0]!.data,
    ultima: ultima.data,
    proxima: somarDias(ultima.data, freq === "mensal" ? 30 : 365),
    category_id: ultima.category_id,
    categoria: cat?.nome ?? null,
    grupo: servicoDe(chave) ?? (cat && !GENERICAS.has(cat.nome) ? cat.nome : null),
    reajuste,
    duplicidade: [],
    // Acabou de ser detectada: so o minimo de cobrancas, nenhuma antes da
    // cadeia e a que completou o minimo nos ultimos 60 dias.
    nova:
      c.length === REGRAS[freq].ocorrencias &&
      todas[0] === c[0] &&
      diasEntre(minimo.data, ctx.hoje) <= DIAS_DE_NOVA,
    account_id: ultima.account_id,
    card_id: ultima.card_id,
    evidencias: c.map((l) => l.id),
  };
}

/** Duas ou mais assinaturas no mesmo grupo (ex.: dois streamings de video). */
function marcarDuplicidade(as: Assinatura[]) {
  const grupos = new Map<string, Assinatura[]>();
  for (const a of as) {
    if (!a.grupo) continue;
    grupos.set(a.grupo, [...(grupos.get(a.grupo) ?? []), a]);
  }
  for (const g of grupos.values())
    if (g.length >= 2)
      for (const a of g) a.duplicidade = g.filter((o) => o !== a).map((o) => o.id);
}

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

export function insightsDeAssinaturas(as: Assinatura[], ctx: Contexto): Insight[] {
  const nomes = new Map(as.map((a) => [a.id, a.nome]));
  return as.map((a) => {
    const severidade: Severidade =
      a.duplicidade.length > 0 ? "alta" : a.reajuste || a.nova ? "media" : "baixa";
    const partes = [
      a.frequencia === "mensal"
        ? `Cobrança mensal de ${brl(a.valor_atual)}`
        : `Cobrança anual de ${brl(a.valor_atual)}`,
      ` desde ${dataBr(a.primeira)} (${a.ocorrencias} cobranças).`,
    ];
    if (a.reajuste)
      partes.push(
        ` Subiu de ${brl(a.reajuste.de)} para ${brl(a.reajuste.para)} (+${a.reajuste.percentual.toLocaleString("pt-BR")}%).`,
      );
    if (a.duplicidade.length)
      partes.push(
        ` Possível duplicidade: você também assina ${a.duplicidade.map((id) => nomes.get(id)).join(", ")} (${a.grupo}).`,
      );
    if (a.nova) partes.push(" Começou nos últimos 60 dias.");
    return {
      id: a.id,
      tipo: "assinatura",
      titulo: `Assinatura: ${a.nome}`,
      descricao: partes.join(""),
      impacto_mensal: a.valor_mensal,
      impacto_anual: a.valor_anual,
      severidade,
      evidencias: a.evidencias,
      acao_sugerida: `Confirme se ainda usa. Cancelar economiza ${brl(a.valor_anual)} por ano.`,
      periodo: { inicio: a.primeira, fim: ctx.hoje },
      dados: { assinatura: a },
    };
  });
}
