import { z } from "zod";
import { IsoDate, Money, Ticker } from "@bolsiq/contracts";

/**
 * Tipos de transacao.
 *
 * `desdobramento` e `grupamento` chegam de `marketdata.dividend.announced.v1`
 * e nao tem preco: alteram quantidade e preco medio sem fluxo de caixa.
 *
 * `saldo_inicial` nasce da carga de posicao (ADR 0025): quem chega ao sistema
 * com a carteira pronta aporta capital na data do extrato, ao preco medio.
 */
export const TipoDeTransacao = z.enum([
  "compra",
  "venda",
  "provento",
  "desdobramento",
  "grupamento",
  "bonificacao",
  "saldo_inicial",
]);
export type TipoDeTransacao = z.infer<typeof TipoDeTransacao>;

export const Quantidade = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "quantidade deve ser string decimal nao negativa");

export const Transacao = z.object({
  id: z.string().min(1),
  ticker: Ticker,
  tipo: TipoDeTransacao,
  data: IsoDate,
  quantidade: Quantidade,
  /** Preco unitario. "0" em desdobramento e grupamento. */
  preco: Money,
  taxas: Money.default("0"),
  corretora: z.string().optional(),
});
export type Transacao = z.infer<typeof Transacao>;

export const ValorDeMercado = z.object({
  ticker: Ticker,
  data: IsoDate,
  preco: Money,
});
export type ValorDeMercado = z.infer<typeof ValorDeMercado>;

export const CLASSES_DE_POSICAO = [
  "acao",
  "fii",
  "bdr",
  "etf",
  "renda_fixa",
  "titulo_publico",
  "fundo",
  "previdencia",
  "coe",
  "estruturado",
  "cripto",
  "outro",
] as const;
export const ClasseDePosicao = z.enum(CLASSES_DE_POSICAO, {
  message: `deve ser uma de: ${CLASSES_DE_POSICAO.join(", ")}`,
});
export type ClasseDePosicao = z.infer<typeof ClasseDePosicao>;

/** Classes que tem cotacao: viram transacao, nao linha em `posicoes`. */
export const CLASSES_COM_TICKER: readonly ClasseDePosicao[] = [
  "acao",
  "fii",
  "bdr",
  "etf",
];

const INDEXADORES = ["CDI", "SELIC", "IPCA", "IGPM", "PRE"] as const;
export const Indexador = z.enum(INDEXADORES, {
  message: `deve ser um de: ${INDEXADORES.join(", ")}`,
});

const VALORIZACOES = ["cotacao_b3", "curva", "tesouro", "cota_cvm", "manual"] as const;
export const Valorizacao = z.enum(VALORIZACOES, {
  message: `deve ser uma de: ${VALORIZACOES.join(", ")}`,
});

const obrigatorio = z.string().min(1, "obrigatorio");
const valorOpcional = Money.nullable();
const dataOpcional = IsoDate.nullable();
const textoOpcional = z.string().nullable();
/** Fracao, nao porcentagem: `14.69` em vez de `0.1469` mudaria o valor por 100. */
const fracaoAte = (limite: number) =>
  Money.nullable().refine((v) => v === null || Number(v) <= limite, {
    message: `deve vir em fracao, ate ${limite} (0.1469 para 14,69%)`,
  });

/** Uma linha do layout de posicao, ja normalizada (docs/services/portfolio.md). */
export const LinhaDePosicao = z
  .object({
    data_posicao: obrigatorio.pipe(IsoDate),
    corretora: obrigatorio,
    classe: ClasseDePosicao,
    subclasse: textoOpcional,
    ativo: obrigatorio,
    codigo: textoOpcional,
    cnpj: z
      .string()
      .regex(/^\d{14}$/, "deve ter 14 digitos")
      .nullable(),
    emissor: textoOpcional,
    indexador: Indexador.nullable(),
    pct_indexador: fracaoAte(5),
    taxa_aa: fracaoAte(1),
    data_aplicacao: dataOpcional,
    vencimento: dataOpcional,
    liquidez_diaria: z.boolean({ invalid_type_error: "deve ser S ou N" }).nullable(),
    quantidade: Quantidade.nullable(),
    preco_unitario: valorOpcional,
    preco_medio: valorOpcional,
    valor_aplicado: valorOpcional,
    saldo_bruto: obrigatorio.pipe(Money),
    ir: valorOpcional,
    iof: valorOpcional,
    saldo_liquido: valorOpcional,
    valorizacao: Valorizacao,
    observacao: textoOpcional,
  })
  .superRefine((l, ctx) => {
    const comTicker = CLASSES_COM_TICKER.includes(l.classe);
    if (comTicker || l.classe === "titulo_publico") {
      if (l.codigo === null)
        ctx.addIssue({
          code: "custom",
          path: ["codigo"],
          message: `obrigatorio em ${l.classe}`,
        });
    }
    if (comTicker) {
      if (l.codigo !== null && !Ticker.safeParse(l.codigo).success)
        ctx.addIssue({
          code: "custom",
          path: ["codigo"],
          message: "ticker deve ter 4 a 12 letras e numeros",
        });
      if (l.quantidade === null)
        ctx.addIssue({
          code: "custom",
          path: ["quantidade"],
          message: `obrigatoria em ${l.classe}`,
        });
    }
  });
export type LinhaDePosicao = z.infer<typeof LinhaDePosicao>;

/** O que fazer com a divergencia de quantidade apontada na revisao. */
export const DecisaoDeDivergencia = z.object({
  corretora: z.string().min(1),
  ticker: Ticker,
  acao: z.enum(["gerar_ajuste", "ignorar"]),
});
export type DecisaoDeDivergencia = z.infer<typeof DecisaoDeDivergencia>;
