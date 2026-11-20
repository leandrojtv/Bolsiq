import { z } from "zod";
import { Cnpj, Count, IsoDate, IsoDateTime, Isin, Money, Ticker } from "../primitives.js";
import { AssetKind } from "../market.js";
import type { AnySchema } from "../openapi.js";

export interface EventDefinition {
  /** Nome versionado; é também o subject no NATS. */
  name: string;
  description: string;
  producer: string;
  consumers: string[];
  payload: AnySchema;
  /** Exemplo válido. Alimenta docs/events.md e é verificado em teste. */
  example: unknown;
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export const QuoteUpdatedV1 = z.object({
  ticker: Ticker,
  price: Money,
  /** Variação absoluta em relação ao fechamento anterior. */
  change: Money,
  ts: IsoDateTime,
});

export const DailyClosedV1 = z.object({
  date: IsoDate,
  assets_updated: Count,
});

export const DividendKind = z.enum([
  "dividendo",
  "jcp",
  "bonificacao",
  "desdobramento",
  "grupamento",
]);

export const DividendAnnouncedV1 = z.object({
  ticker: Ticker,
  kind: DividendKind,
  /** Valor por ação; nulo em desdobramento e grupamento, que usam `ratio`. */
  value_per_share: Money.nullable(),
  /** Razão do desdobramento ou grupamento, ex. "1:2"; nulo nos demais. */
  ratio: z.string().nullable(),
  ex_date: IsoDate,
  payment_date: IsoDate.nullable(),
});

export const StatementPublishedV1 = z.object({
  /** Código CVM: a demonstração é da companhia, não de um papel. */
  cvm_code: z.string().min(1),
  /** Tickers da companhia, quando conhecidos. Pode vir vazio. */
  tickers: z.array(Ticker),
  period_end: IsoDate,
  statement_kind: z.enum(["DFP", "ITR"]),
});

export const FiiReportPublishedV1 = z.object({
  /** CNPJ da classe do FII: o informe e do fundo, nao de um papel. */
  cnpj: Cnpj,
  /** Tickers do fundo, ligados pelo ISIN. So emite com pelo menos um. */
  tickers: z.array(Ticker).min(1),
  /** Competencia mais recente que mudou (primeiro dia do mes). */
  reference_date: IsoDate,
});

export const AssetListedV1 = z.object({
  ticker: Ticker,
  isin: Isin.nullable(),
  kind: AssetKind,
  name: z.string().min(1),
  listed_at: IsoDate,
});

export const AssetDelistedV1 = z.object({
  ticker: Ticker,
  kind: AssetKind,
  delisted_at: IsoDate,
  reason: z.string().nullable(),
});

export const IndicatorsUpdatedV1 = z.object({
  ticker: Ticker,
  reference_date: IsoDate,
  /** Preco justo de Graham; nulo quando LPA ou VPA nao sao positivos. */
  preco_graham: Money.nullable(),
  /** Preco-teto de Bazin; nulo sem historico de proventos. */
  preco_bazin: Money.nullable(),
  dy_12m: z.number().nullable(),
  pl: z.number().nullable(),
  pvp: z.number().nullable(),
});

// Bolsiq Financas (ADR 0037). Todo evento traz o `user_id` e uma `chave`
// estavel do fato: e o que deixa o consumidor gravar o aviso uma vez so.

const UsuarioEChave = {
  user_id: z.string().min(1),
  /** Identidade do fato, estavel entre recalculos. */
  chave: z.string().min(1),
};

export const FinanceInsightNovoV1 = z.object({
  ...UsuarioEChave,
  insight_id: z.string().min(1),
  motivo: z.enum(["assinatura_nova", "reajuste", "tarifa_nova"]),
  tipo: z.string().min(1),
  titulo: z.string().min(1),
  descricao: z.string(),
  impacto_mensal: Money,
  impacto_anual: Money,
  /** Mes dos insights, `YYYY-MM`. */
  periodo: z.string().regex(/^\d{4}-\d{2}$/),
});

export const FinanceImportacaoConfirmadaV1 = z.object({
  import_id: z.string().min(1),
  user_id: z.string().min(1),
  alvo: z.string().min(1),
  account_id: z.string().nullable(),
  card_id: z.string().nullable(),
  statement_id: z.string().nullable(),
  inicio: IsoDate.nullable(),
  fim: IsoDate.nullable(),
  lancamentos: Count,
  conciliados: Count,
});

export const FinanceFaturaVencendoV1 = z.object({
  ...UsuarioEChave,
  statement_id: z.string().min(1),
  card_id: z.string().min(1),
  cartao: z.string().min(1),
  vencimento: IsoDate,
  /** Compras menos estornos e pagamentos ja feitos. */
  valor: Money,
  dias: z.number().int().nonnegative(),
});

export const FinanceOrcamentoLimiteV1 = z.object({
  ...UsuarioEChave,
  /** Mes do orcamento, `YYYY-MM`. */
  mes: z.string().regex(/^\d{4}-\d{2}$/),
  category_id: z.string().min(1),
  categoria: z.string().min(1),
  /** 80 ou 100: o limiar cruzado. */
  limiar: z.union([z.literal(80), z.literal(100)]),
  planejado: Money,
  consumo: Money,
  percentual: z.number(),
});

export const FinanceSaldoNegativoV1 = z.object({
  ...UsuarioEChave,
  /** Primeiro mes projetado com saldo final negativo, `YYYY-MM`. */
  mes: z.string().regex(/^\d{4}-\d{2}$/),
  saldo_final: Money,
});

export const FinanceReceitaAtrasadaV1 = z.object({
  ...UsuarioEChave,
  transaction_id: z.string().min(1),
  descricao: z.string().min(1),
  valor: Money,
  /** Data prevista que passou sem a receita virar realizada. */
  data: IsoDate,
  dias_de_atraso: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Catálogo

// ---------------------------------------------------------------------------

export const eventos = {
  "marketdata.quote.updated.v1": {
    name: "marketdata.quote.updated.v1",
    description:
      "Cotação de um ativo foi atualizada. Emitido a cada preço novo gravado em quotes_daily.",
    producer: "market-data",
    consumers: ["apps/web (WebSocket /v1/stream)", "alerts"],
    payload: QuoteUpdatedV1,
    example: {
      ticker: "PETR4",
      price: "38.42",
      change: "-0.58",
      ts: "2026-10-31T21:05:00Z",
    },
  },
  "marketdata.daily.closed.v1": {
    name: "marketdata.daily.closed.v1",
    description:
      "A carga diária do COTAHIST terminou. Marca o momento a partir do qual o dia está completo.",
    producer: "market-data",
    consumers: ["analytics", "portfolio"],
    payload: DailyClosedV1,
    example: { date: "2026-10-31", assets_updated: 1842 },
  },
  "marketdata.dividend.announced.v1": {
    name: "marketdata.dividend.announced.v1",
    description:
      "Provento anunciado. É o gatilho do recálculo de adj_close (job ajuste-proventos).",
    producer: "market-data",
    consumers: ["market-data (ajuste-proventos)", "portfolio", "alerts"],
    payload: DividendAnnouncedV1,
    example: {
      ticker: "PETR4",
      kind: "dividendo",
      value_per_share: "1.25",
      ratio: null,
      ex_date: "2026-11-10",
      payment_date: "2026-11-25",
    },
  },
  "marketdata.statement.published.v1": {
    name: "marketdata.statement.published.v1",
    description:
      "Demonstração financeira nova ou reapresentada foi gravada. Reapresentação também emite.",
    producer: "market-data",
    consumers: ["analytics"],
    payload: StatementPublishedV1,
    example: {
      cvm_code: "9512",
      tickers: ["PETR3", "PETR4"],
      period_end: "2026-09-30",
      statement_kind: "ITR",
    },
  },
  "marketdata.fii.report.published.v1": {
    name: "marketdata.fii.report.published.v1",
    description:
      "Informe mensal de FII novo ou reapresentado foi gravado. Um evento por fundo, com a competência mais recente que mudou.",
    producer: "market-data",
    consumers: ["analytics"],
    payload: FiiReportPublishedV1,
    example: {
      cnpj: "11728688000147",
      tickers: ["HGLG11"],
      reference_date: "2026-09-01",
    },
  },
  "marketdata.asset.listed.v1": {
    name: "marketdata.asset.listed.v1",
    description: "Ativo novo entrou no universo.",
    producer: "market-data",
    consumers: ["apps/web", "analytics"],
    payload: AssetListedV1,
    example: {
      ticker: "NEWX3",
      isin: "BRNEWXACNOR1",
      kind: "stock",
      name: "Nova Empresa",
      listed_at: "2026-10-01",
    },
  },
  "marketdata.asset.delisted.v1": {
    name: "marketdata.asset.delisted.v1",
    description: "Ativo saiu do universo. Dado histórico permanece.",
    producer: "market-data",
    consumers: ["apps/web", "analytics", "portfolio"],
    payload: AssetDelistedV1,
    example: {
      ticker: "OLDX3",
      kind: "stock",
      delisted_at: "2026-09-15",
      reason: "fechamento de capital",
    },
  },
  "analytics.indicators.updated.v1": {
    name: "analytics.indicators.updated.v1",
    description:
      "Indicadores de um ativo foram recalculados. Alimenta os alertas fundamentalistas sem que o alerts leia o schema analytics.",
    producer: "analytics",
    consumers: ["alerts"],
    payload: IndicatorsUpdatedV1,
    example: {
      ticker: "PETR4",
      reference_date: "2026-09-30",
      preco_graham: "42.92",
      preco_bazin: "88.33",
      dy_12m: 0.0989,
      pl: 13.38,
      pvp: 1.35,
    },
  },
  "finance.insight.novo.v1": {
    name: "finance.insight.novo.v1",
    description:
      "Assinatura nova, reajuste de assinatura ou tarifa nova detectados no recalculo dos insights do mes corrente. Um evento por fato.",
    producer: "finance (portfolio-worker, job finance.insights)",
    consumers: ["alerts"],
    payload: FinanceInsightNovoV1,
    example: {
      user_id: "user-123",
      chave: "assinatura_nova:assinatura:netflix",
      insight_id: "assinatura:netflix",
      motivo: "assinatura_nova",
      tipo: "assinatura",
      titulo: "Assinatura: NETFLIX",
      descricao: "R$ 44,90 por mes desde outubro.",
      impacto_mensal: "44.90",
      impacto_anual: "538.80",
      periodo: "2026-11",
    },
  },
  "finance.importacao.confirmada.v1": {
    name: "finance.importacao.confirmada.v1",
    description:
      "Importacao de extrato (OFX, CSV) confirmada pelo usuario: lancamentos gravados e conciliados.",
    producer: "finance (apps/web)",
    consumers: ["nenhum ainda (auditoria)"],
    payload: FinanceImportacaoConfirmadaV1,
    example: {
      import_id: "8f7c1a52-1f0e-4f3b-9c55-0e2d0b7a1c11",
      user_id: "user-123",
      alvo: "conta",
      account_id: "c0ffee00-0000-4000-8000-000000000001",
      card_id: null,
      statement_id: null,
      inicio: "2026-10-01",
      fim: "2026-10-31",
      lancamentos: 42,
      conciliados: 3,
    },
  },
  "finance.fatura.vencendo.v1": {
    name: "finance.fatura.vencendo.v1",
    description:
      "Fatura de cartao vence em ate 3 dias e ainda tem valor a pagar. Um evento por fatura.",
    producer: "finance (portfolio-worker, job finance.vigia)",
    consumers: ["alerts"],
    payload: FinanceFaturaVencendoV1,
    example: {
      user_id: "user-123",
      chave: "fatura_vencendo:5b1e0f4e-2a8c-4d7e-9f00-1c2d3e4f5a6b",
      statement_id: "5b1e0f4e-2a8c-4d7e-9f00-1c2d3e4f5a6b",
      card_id: "c0ffee00-0000-4000-8000-000000000002",
      cartao: "Nubank",
      vencimento: "2026-11-23",
      valor: "1830.45",
      dias: 3,
    },
  },
  "finance.orcamento.limite.v1": {
    name: "finance.orcamento.limite.v1",
    description:
      "Consumo de uma categoria (realizado + previsto) chegou a 80% ou a 100% do planejado no mes. Um evento por categoria, mes e limiar.",
    producer: "finance (portfolio-worker, job finance.vigia)",
    consumers: ["alerts"],
    payload: FinanceOrcamentoLimiteV1,
    example: {
      user_id: "user-123",
      chave: "orcamento:2026-11:c0ffee00-0000-4000-8000-000000000003:80",
      mes: "2026-11",
      category_id: "c0ffee00-0000-4000-8000-000000000003",
      categoria: "Restaurantes e delivery",
      limiar: 80,
      planejado: "600.00",
      consumo: "512.30",
      percentual: 85.4,
    },
  },
  "finance.saldo.negativo.v1": {
    name: "finance.saldo.negativo.v1",
    description:
      "O fluxo projetado mostra um mes com saldo final negativo nas contas. Um evento por mes projetado.",
    producer: "finance (portfolio-worker, job finance.vigia)",
    consumers: ["alerts"],
    payload: FinanceSaldoNegativoV1,
    example: {
      user_id: "user-123",
      chave: "saldo_negativo:2026-12",
      mes: "2026-12",
      saldo_final: "-420.10",
    },
  },
  "finance.receita.atrasada.v1": {
    name: "finance.receita.atrasada.v1",
    description:
      "Receita prevista (salario, por exemplo) passou da data sem ser realizada. Um evento por lancamento previsto e data.",
    producer: "finance (portfolio-worker, job finance.vigia)",
    consumers: ["alerts"],
    payload: FinanceReceitaAtrasadaV1,
    example: {
      user_id: "user-123",
      chave: "receita_atrasada:c0ffee00-0000-4000-8000-000000000004:2026-11-05",
      transaction_id: "c0ffee00-0000-4000-8000-000000000004",
      descricao: "Salario",
      valor: "6000.00",
      data: "2026-11-05",
      dias_de_atraso: 2,
    },
  },
} as const satisfies Record<string, EventDefinition>;

export type EventName = keyof typeof eventos;

export const nomesDeEventos = Object.keys(eventos) as EventName[];

/** Stream do JetStream que captura todos os eventos deste domínio. */
export const STREAM_MARKETDATA = "MARKETDATA";

/** Assunto curinga do stream. */
export const SUBJECT_MARKETDATA = "marketdata.>";

export const STREAM_ANALYTICS = "ANALYTICS";
export const SUBJECT_ANALYTICS = "analytics.>";

export const STREAM_FINANCE = "FINANCE";
export const SUBJECT_FINANCE = "finance.>";

/**
 * Stream de cada dominio, pelo prefixo do nome do evento.
 *
 * Um stream por produtor, e nao um unico, porque retencao e limite sao
 * decisoes do produtor: cotacao e muitas por dia, indicador e uma por
 * trimestre.
 */
export const streams = {
  marketdata: { name: STREAM_MARKETDATA, subject: SUBJECT_MARKETDATA },
  analytics: { name: STREAM_ANALYTICS, subject: SUBJECT_ANALYTICS },
  // Poucos eventos por usuario, consumidos na hora. Sem reserva de bytes (-1):
  // MARKETDATA e ANALYTICS ja reservam os 16 GB do `max_file_store` do
  // nats.conf, e qualquer reserva a mais e recusada. O teto e por mensagens e
  // pela idade (30 dias, a mesma dos outros).
  finance: {
    name: STREAM_FINANCE,
    subject: SUBJECT_FINANCE,
    max_bytes: -1,
    max_msgs: 1_000_000,
  },
} as const;

export function streamDoEvento(
  nome: string,
): (typeof streams)[keyof typeof streams] | undefined {
  const dominio = nome.split(".")[0] ?? "";
  return dominio in streams ? streams[dominio as keyof typeof streams] : undefined;
}

export function ehNomeDeEvento(nome: string): nome is EventName {
  return Object.prototype.hasOwnProperty.call(eventos, nome);
}

export function acharEvento(nome: string): EventDefinition | undefined {
  return ehNomeDeEvento(nome) ? eventos[nome] : undefined;
}

/**
 * Valida o payload contra o schema do evento.
 *
 * Nome desconhecido é erro, não aviso: um consumidor que recebe nome que não
 * conhece não pode decidir se o ignora com segurança.
 *
 * Não revalida o formato do nome aqui: se `acharEvento` encontrou, o nome veio
 * do catálogo, e um teste garante que todo nome do catálogo casa com
 * `EVENT_NAME_PATTERN`. Checar de novo seria ramo inalcançável.
 */
export function validarPayload(
  nome: string,
  payload: unknown,
): { ok: true; payload: unknown } | { ok: false; erro: string } {
  const definicao = acharEvento(nome);
  if (!definicao) {
    return { ok: false, erro: `evento desconhecido: ${nome}` };
  }
  const resultado = definicao.payload.safeParse(payload);
  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("; ");
    return { ok: false, erro: `payload inválido para ${nome} — ${problemas}` };
  }

  return { ok: true, payload: resultado.data };
}
