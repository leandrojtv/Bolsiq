import { z } from "zod";
import { decimalDigitado } from "./alertas-modelo";

/** Formularios e calculos da tela de carteira, sem banco: navegador e BFF. */

export const TIPOS_DE_TRANSACAO = [
  { tipo: "compra", rotulo: "Compra" },
  { tipo: "venda", rotulo: "Venda" },
  { tipo: "provento", rotulo: "Provento" },
  { tipo: "desdobramento", rotulo: "Desdobramento" },
  { tipo: "grupamento", rotulo: "Grupamento" },
  { tipo: "bonificacao", rotulo: "Bonificação" },
  // Gerado pela carga de posicao; editavel como qualquer outro (#86).
  { tipo: "saldo_inicial", rotulo: "Saldo inicial" },
] as const;
export type TipoNaTela = (typeof TIPOS_DE_TRANSACAO)[number]["tipo"];

/** Em desdobramento e grupamento a "quantidade" e o fator e nao ha preco. */
export const SEM_PRECO: TipoNaTela[] = ["desdobramento", "grupamento"];
/** Preco zero e valido: bonificacao sem preco de emissao, saldo inicial sem preco medio. */
const SEM_PRECO_OBRIGATORIO: TipoNaTela[] = ["bonificacao", "saldo_inicial"];

const decimal = (campo: string, permiteZero: boolean) =>
  z.string().transform((v, ctx) => {
    const d = decimalDigitado(v);
    if (d === null || (!permiteZero && Number(d) <= 0)) {
      ctx.addIssue({ code: "custom", message: `${campo} inválido` });
      return z.NEVER;
    }
    return d;
  });

export const NovaTransacao = z
  .object({
    ticker: z
      .string()
      .trim()
      .transform((t) => t.toUpperCase())
      .pipe(z.string().regex(/^[A-Z0-9]{4,12}$/, "ticker inválido")),
    tipo: z.enum(TIPOS_DE_TRANSACAO.map((t) => t.tipo) as [TipoNaTela, ...TipoNaTela[]]),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida"),
    quantidade: decimal("quantidade", false),
    preco: decimal("preço", true),
    taxas: decimal("taxas", true).default("0"),
    corretora: z.string().trim().max(60).optional(),
  })
  .superRefine((t, ctx) => {
    if (
      !SEM_PRECO.includes(t.tipo) &&
      !SEM_PRECO_OBRIGATORIO.includes(t.tipo) &&
      Number(t.preco) <= 0
    )
      ctx.addIssue({ code: "custom", path: ["preco"], message: "informe o preço" });
  });
export type NovaTransacao = z.infer<typeof NovaTransacao>;
/** O que o formulario envia: o BFF valida o texto digitado, nao o ja convertido. */
export type TransacaoDigitada = z.input<typeof NovaTransacao>;

const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    s.nullable(),
  );

/** "120" (por cento) vira "1.2", a fracao que o banco guarda. */
const percentual = (campo: string) =>
  opcional(
    z.string().transform((v, ctx) => {
      const d = decimalDigitado(v);
      if (d === null) {
        ctx.addIssue({ code: "custom", message: `${campo} inválido` });
        return z.NEVER;
      }
      return semZeros((Number(d) / 100).toFixed(8));
    }),
  );

export const EdicaoDePosicao = z.object({
  ativo: z.string().trim().min(1, "informe o ativo").max(200),
  saldo_bruto: decimal("saldo bruto", true),
  valor_aplicado: opcional(decimal("valor aplicado", true)),
  saldo_liquido: opcional(decimal("saldo líquido", true)),
  vencimento: opcional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "vencimento inválido")),
  indexador: opcional(
    z
      .string()
      .trim()
      .max(20)
      .transform((v) => v.toUpperCase()),
  ),
  pct_indexador: percentual("% do indexador"),
  taxa_aa: percentual("taxa ao ano"),
});
export type EdicaoDePosicao = z.infer<typeof EdicaoDePosicao>;
export type PosicaoDigitada = Record<keyof EdicaoDePosicao, string>;

/** "18.030000" vira "18.03"; "100.00000000" vira "100". */
export function semZeros(v: string): string {
  return v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v;
}

/** Valor do banco no campo do formulario: virgula decimal, sem zeros a direita. */
export function paraCampo(v: string | null, emPercentual = false): string {
  if (v === null) return "";
  const n = emPercentual ? (Number(v) * 100).toFixed(6) : v;
  return semZeros(n).replace(".", ",");
}

export const NovaCarteira = z.object({
  nome: z.string().trim().min(1, "dê um nome").max(40, "até 40 caracteres"),
});

export type Agrupamento = "classe" | "setor" | "ativo";

/** O layout de posicao se reconhece pelo cabecalho (docs/services/portfolio.md). */
export function ehLayoutDePosicao(conteudo: string): boolean {
  const cabecalho = conteudo.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const colunas = cabecalho.split(/[;,]/).map((c) => c.trim().toLowerCase());
  return colunas.includes("data_posicao") && colunas.includes("classe");
}

/** Data do banco ("2026-11-05") sem passar por `Date`, que mudaria o dia pelo fuso. */
export const diaEMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const dataCompleta = (iso: string) => iso.split("-").reverse().join("/");

/** "120% CDI", "IPCA + 7,95%" ou "14,69% a.a.": o que a linha de renda fixa rende. */
export function indexadorETaxa(p: {
  indexador: string | null;
  pct_indexador: string | null;
  taxa_aa: string | null;
}): string {
  const pct = (v: string) =>
    `${(Number(v) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  const indexador = p.indexador === "PRE" ? null : p.indexador;
  if (p.pct_indexador !== null)
    return `${pct(p.pct_indexador)}${indexador ? ` ${indexador}` : ""}`;
  if (p.taxa_aa !== null)
    return indexador ? `${indexador} + ${pct(p.taxa_aa)}` : `${pct(p.taxa_aa)} a.a.`;
  return indexador ?? "-";
}

export const CLASSE: Record<string, string> = {
  stock: "Ações",
  fii: "FIIs",
  bdr: "BDRs",
  etf: "ETFs",
  fund: "Fundos",
};

/** Os ultimos 12 meses ("2025-12" a "2026-11"), com zero onde nao houve provento. */
export function ultimos12Meses(
  porMes: { mes: string; valor: string }[],
  hoje: string,
): { mes: string; valor: number }[] {
  const mapa = new Map(porMes.map((p) => [p.mes, Number(p.valor)]));
  const [a, m] = hoje.split("-").map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 12 + i, 1));
    const mes = d.toISOString().slice(0, 7);
    return { mes, valor: mapa.get(mes) ?? 0 };
  });
}

/** Mesma data 12 meses antes. */
export function umAnoAntes(hoje: string): string {
  const d = new Date(`${hoje}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Serie de nivel alinhada as datas da carteira, em base 100 na primeira.
 * Data sem ponto repete o anterior (feriado, serie mensal); antes do primeiro
 * ponto fica nula.
 */
export function alinhar(
  datas: string[],
  niveis: { date: string; valor: number }[],
): (number | null)[] {
  const ordenados = [...niveis].sort((a, b) => a.date.localeCompare(b.date));
  let i = 0;
  let atual: number | null = null;
  const brutos = datas.map((d) => {
    while (i < ordenados.length && (ordenados[i]?.date ?? "") <= d)
      atual = ordenados[i++]?.valor ?? atual;
    return atual;
  });
  const base = brutos.find((v) => v !== null && v > 0) ?? null;
  return brutos.map((v) => (v === null || base === null ? null : (v / base) * 100));
}

/**
 * IPCA + 6% a.a. como nivel: cada mes compoe o IPCA do mes e 6% ao ano
 * proporcional, `(1 + ipca) * 1,06^(1/12)`. O ponto vale no fim do mes.
 */
export function ipcaMais6(
  ipcaMensal: { date: string; value: string }[],
): { date: string; valor: number }[] {
  const mensal6 = Math.pow(1.06, 1 / 12);
  let nivel = 1;
  return [...ipcaMensal]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => {
      nivel *= (1 + Number(p.value) / 100) * mensal6;
      return { date: p.date, valor: nivel };
    });
}

/** Retorno entre o primeiro e o ultimo valor nao nulo da serie em base 100. */
export function retornoDaSerie(serie: (number | null)[]): number | null {
  const v = serie.filter((x): x is number => x !== null);
  const [a, b] = [v[0], v.at(-1)];
  return a && b ? b / a - 1 : null;
}
