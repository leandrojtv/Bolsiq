import { z } from "zod";
import { valorDigitado } from "./decimal.js";
import {
  MODOS_DE_REGRA,
  ORIGENS_DE_REGRA,
  regexValida,
} from "./importacao/categorizar.js";

/** Schemas de cartao, fatura, importacao e regra do BFF /api/financas. */

const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida");
const Id = z.string().min(1).max(64);
const Dinheiro = z.string().regex(/^-?\d+\.\d{2}$/);
const Dia = z.coerce.number().int().min(1, "dia de 1 a 31").max(31, "dia de 1 a 31");
const textoOpcional = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max).nullable().optional(),
  );
const ValorOpcional = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string()
    .transform((v, ctx) => {
      const n = valorDigitado(v);
      if (n === null) {
        ctx.addIssue({ code: "custom", message: "valor inválido" });
        return z.NEVER;
      }
      return n;
    })
    .nullable()
    .optional(),
);

// Cartoes

export const NovoCartao = z.object({
  nome: z.string().trim().min(1, "informe o nome").max(60),
  instituicao: textoOpcional(60),
  final: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z
      .string()
      .regex(/^\d{4}$/, "os 4 últimos dígitos")
      .nullable()
      .optional(),
  ),
  bandeira: textoOpcional(30),
  cor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "cor inválida")
    .nullable()
    .optional(),
  limite: ValorOpcional,
  dia_fechamento: Dia,
  dia_vencimento: Dia,
  account_id: Id.nullable().optional(),
});
export type NovoCartao = z.infer<typeof NovoCartao>;
export type CartaoDigitado = z.input<typeof NovoCartao>;

export const EdicaoDeCartao = NovoCartao.partial().extend({
  arquivado: z.boolean().optional(),
});
export type EdicaoDeCartao = z.infer<typeof EdicaoDeCartao>;

export const ResumoDeFatura = z.object({
  /** null enquanto a fatura nao tem lancamento (nao foi criada). */
  id: Id.nullable(),
  vencimento: Data,
  fechamento: Data,
  status: z.enum(["aberta", "fechada", "paga"]),
  /** Total informado pelo banco na importacao. */
  total_informado: Dinheiro.nullable(),
  /** Compras menos estornos. */
  total: Dinheiro,
  pagamentos: Dinheiro,
  lancamentos: z.number().int(),
});
export type ResumoDeFatura = z.infer<typeof ResumoDeFatura>;

export const Cartao = z.object({
  id: Id,
  nome: z.string(),
  instituicao: z.string().nullable(),
  final: z.string().nullable(),
  bandeira: z.string().nullable(),
  cor: z.string().nullable(),
  limite: Dinheiro.nullable(),
  /** Compras ainda nao pagas (todas as faturas). */
  limite_usado: Dinheiro,
  dia_fechamento: z.number().int(),
  dia_vencimento: z.number().int(),
  account_id: Id.nullable(),
  arquivado: z.boolean(),
  /** A fatura em que entra uma compra feita hoje. */
  fatura_atual: ResumoDeFatura,
  proxima_fatura: ResumoDeFatura,
});
export type Cartao = z.infer<typeof Cartao>;

// Importacao

export const ALVOS = ["conta", "cartao"] as const;
export const STATUS_DE_IMPORTACAO = [
  "revisao",
  "confirmada",
  "cancelada",
  "desfeita",
] as const;
export const SITUACOES = ["nova", "ja_importada", "possivel_duplicata"] as const;
export const ACOES = ["importar", "ignorar", "conciliar"] as const;

/** Campos de texto do multipart que cria a importacao (os arquivos vao em `arquivos`). */
export const NovaImportacao = z
  .object({
    alvo: z.enum(ALVOS),
    account_id: Id.optional(),
    card_id: Id.optional(),
    /** Fatura do cartao pelo vencimento. */
    vencimento: Data.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.alvo === "conta" && !v.account_id)
      ctx.addIssue({ code: "custom", path: ["account_id"], message: "escolha a conta" });
    if (v.alvo === "cartao" && (!v.card_id || !v.vencimento))
      ctx.addIssue({
        code: "custom",
        path: ["vencimento"],
        message: "escolha o cartão e a fatura",
      });
  });
export type NovaImportacao = z.infer<typeof NovaImportacao>;

export const AnaliseDeArquivo = z.object({
  nome: z.string(),
  formato: z.string(),
  tipo: z.enum(ALVOS).nullable(),
  banco: z.string().nullable(),
  conta: z.string().nullable(),
  inicio: Data.nullable(),
  fim: Data.nullable(),
  linhas: z.number().int(),
  avisos: z.array(z.string()),
});

export const AnaliseDeImportacao = z.object({
  arquivos: z.array(AnaliseDeArquivo),
  /** Destino sugerido pelo BANKID/ACCTID, pelo final do cartao ou por importacao anterior. */
  sugestao: z.object({
    alvo: z.enum(ALVOS).nullable(),
    account_id: Id.nullable(),
    card_id: Id.nullable(),
    /** Fatura sugerida pelo ciclo, a partir da ultima data do arquivo. */
    vencimento: Data.nullable(),
  }),
});
export type AnaliseDeImportacao = z.infer<typeof AnaliseDeImportacao>;

const Divisao = z.object({ category_id: Id, valor: Dinheiro });

export const LinhaDeImportacao = z.object({
  id: Id,
  ordem: z.number().int(),
  arquivo: z.number().int(),
  fitid: z.string().nullable(),
  data: Data,
  valor: Dinheiro,
  tipo: z.enum(["receita", "despesa"]),
  descricao_original: z.string(),
  descricao_normalizada: z.string(),
  parcela_atual: z.number().int().nullable(),
  parcela_total: z.number().int().nullable(),
  situacao: z.enum(SITUACOES),
  duplicata_de: Id.nullable(),
  /** Descricao do lancamento parecido, para o usuario decidir. */
  duplicata_descricao: z.string().nullable(),
  categoria_detectada: Id.nullable(),
  origem_categoria: z.enum(["regra", "historico", "nenhuma"]),
  selecionada: z.boolean(),
  acao: z.enum(ACOES),
  category_id: Id.nullable(),
  categoria_editada: z.boolean(),
  transferencia_conta_id: Id.nullable(),
  transferencia_cartao_id: Id.nullable(),
  /** Pagamento de fatura ou transferencia propria pela descricao. */
  sugere_transferencia: z.boolean(),
  divisoes: z.array(Divisao).nullable(),
});
export type LinhaDeImportacao = z.infer<typeof LinhaDeImportacao>;

export const TotaisDeImportacao = z.object({
  linhas: z.number().int(),
  selecionadas: z.number().int(),
  /** Soma com sinal das selecionadas (receita positiva). */
  total: Dinheiro,
  duplicadas: z.number().int(),
  possiveis_duplicatas: z.number().int(),
  sem_categoria: z.number().int(),
  gravadas: z.number().int(),
});
export type TotaisDeImportacao = z.infer<typeof TotaisDeImportacao>;

export const Importacao = z.object({
  id: Id,
  origem: z.string(),
  alvo: z.enum(ALVOS),
  account_id: Id.nullable(),
  card_id: Id.nullable(),
  statement_id: Id.nullable(),
  vencimento: Data.nullable(),
  arquivo_nome: z.string(),
  status: z.enum(STATUS_DE_IMPORTACAO),
  inicio: Data.nullable(),
  fim: Data.nullable(),
  totais: TotaisDeImportacao,
  /** LEDGERBAL contra o saldo da conta depois de importar (so conta). */
  conferencia: z
    .object({
      data: Data,
      saldo_informado: Dinheiro,
      saldo_calculado: Dinheiro,
      confere: z.boolean(),
    })
    .nullable(),
  /** Pode desfazer: confirmada e nenhum lancamento conciliado. */
  pode_desfazer: z.boolean(),
  criada_em: z.string(),
  confirmada_em: z.string().nullable(),
});
export type Importacao = z.infer<typeof Importacao>;

export const ImportacaoComLinhas = Importacao.extend({
  linhas: z.array(LinhaDeImportacao),
});
export type ImportacaoComLinhas = z.infer<typeof ImportacaoComLinhas>;

export const EdicaoDeLinha = z
  .object({
    selecionada: z.boolean().optional(),
    acao: z.enum(ACOES).optional(),
    category_id: Id.nullable().optional(),
    /** Com category_id: aplica a todas as linhas com a mesma descricao normalizada. */
    aplicar_a_iguais: z.boolean().optional(),
    /** Com category_id: cria regra do usuario (contem a descricao normalizada). */
    criar_regra: z.boolean().optional(),
    /** Marca como transferencia para esta conta ou cartao; null desmarca. */
    transferencia_conta_id: Id.nullable().optional(),
    transferencia_cartao_id: Id.nullable().optional(),
    /** Duas categorias; null desfaz a divisao. */
    divisoes: z
      .array(z.object({ category_id: Id, valor: z.string() }))
      .length(2, "divida em duas categorias")
      .nullable()
      .optional(),
  })
  .refine((e) => !(e.transferencia_conta_id && e.transferencia_cartao_id), {
    message: "escolha conta ou cartão",
    path: ["transferencia_conta_id"],
  });
export type EdicaoDeLinha = z.infer<typeof EdicaoDeLinha>;

export const ParametroLinha = z.object({ id: Id, linha: Id });

// Regras

const RegraBase = z.object({
  padrao: z.string().trim().min(2, "padrão curto demais").max(200),
  modo: z.enum(MODOS_DE_REGRA).default("contem"),
  category_id: Id,
  prioridade: z.coerce.number().int().min(0).max(10_000).default(100),
});

const regexDoModo = (r: { modo?: string | undefined; padrao?: string | undefined }) =>
  r.modo !== "regex" || r.padrao === undefined || regexValida(r.padrao);

export const NovaRegra = RegraBase.refine(regexDoModo, {
  message: "expressão regular inválida",
  path: ["padrao"],
});
export type NovaRegra = z.infer<typeof NovaRegra>;
export type RegraDigitada = z.input<typeof NovaRegra>;

export const EdicaoDeRegra = RegraBase.partial().refine(regexDoModo, {
  message: "expressão regular inválida",
  path: ["padrao"],
});
export type EdicaoDeRegra = z.infer<typeof EdicaoDeRegra>;

export const Regra = z.object({
  id: Id,
  padrao: z.string(),
  modo: z.enum(MODOS_DE_REGRA),
  category_id: Id,
  prioridade: z.number().int(),
  origem: z.enum(ORIGENS_DE_REGRA),
  vezes_aplicada: z.number().int(),
  criada_em: z.string(),
});
export type Regra = z.infer<typeof Regra>;
