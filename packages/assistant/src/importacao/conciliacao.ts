import { Decimal } from "decimal.js";

/**
 * Conta e texto da importacao com IA que o navegador tambem usa: sem nada de
 * servidor, para a tela refazer a soma quando o usuario desmarca ou edita linha.
 */

export const TOLERANCIA_PADRAO = 0.005;

/** Campos do layout de posicao como texto; vazio e "nao informado". */
export type LinhaDePosicaoEmTexto = Record<string, string>;

export interface TotalDeclarado {
  descricao: string;
  valor: string;
}

export interface ConciliacaoDaCorretora {
  corretora: string;
  soma: string;
  /** O total do documento usado na comparacao: o que bateu, ou o maior. */
  declarado: string | null;
  descricao: string | null;
  diferenca: string | null;
  conciliada: boolean;
}

const decimal = (v: string): Decimal | null => {
  try {
    return new Decimal(v.trim());
  } catch {
    return null;
  }
};

/** "1234.56" ou "1.234,56", como o normalizador do CSV. */
export function lerValor(v: string): Decimal | null {
  const t = v.replace(/[R$\s]/g, "");
  if (t === "") return null;
  return decimal(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
}

/** Total que parece geral vem antes de subtotal: "Patrimônio total" antes de "Ações". */
const pareceGeral = (descricao: string) =>
  /total|patrim|saldo bruto|consolidad/i.test(descricao);

/**
 * Soma de `saldo_bruto` contra os totais declarados no documento. Concilia se
 * algum total geral bate dentro da tolerancia (0,5% por padrao); sem total geral,
 * vale qualquer total declarado. Sem total nenhum, nao concilia: nao ha com o que
 * conferir, e o usuario precisa confirmar.
 */
export function conciliar(
  corretora: string,
  saldos: string[],
  totais: TotalDeclarado[],
  tolerancia = TOLERANCIA_PADRAO,
): ConciliacaoDaCorretora {
  const soma = saldos.reduce((s, v) => s.plus(lerValor(v) ?? 0), new Decimal(0));
  const lidos = totais.flatMap((t) => {
    const v = lerValor(t.valor);
    return v && v.gt(0) ? [{ descricao: t.descricao, valor: v }] : [];
  });
  const gerais = lidos.filter((t) => pareceGeral(t.descricao));
  const candidatos = (gerais.length > 0 ? gerais : lidos).sort((a, b) =>
    b.valor.comparedTo(a.valor),
  );
  const bate = (v: Decimal) => soma.minus(v).abs().lte(v.times(tolerancia));
  const escolhido = candidatos.find((t) => bate(t.valor)) ?? candidatos[0] ?? null;
  return {
    corretora,
    soma: soma.toFixed(2),
    declarado: escolhido ? escolhido.valor.toFixed(2) : null,
    descricao: escolhido?.descricao ?? null,
    diferenca: escolhido ? soma.minus(escolhido.valor).toFixed(2) : null,
    conciliada: escolhido !== null && bate(escolhido.valor),
  };
}

/** Linha do CSV com aspas em todo campo: nome de fundo e de COE tem virgula. */
const campo = (v: string) => `"${v.replace(/[\r\n]+/g, " ").replace(/"/g, '""')}"`;

/** Linhas da revisao de volta ao layout `posicao_bolsiq`, para os validadores de sempre. */
export function csvDePosicoes(
  colunas: readonly string[],
  linhas: LinhaDePosicaoEmTexto[],
): string {
  return [
    colunas.join(","),
    ...linhas.map((l) => colunas.map((c) => campo(l[c] ?? "")).join(",")),
  ].join("\n");
}

/** O CSV de transacoes nao tem aspas: `;` some do campo, e o separador e `;`. */
export function csvDeTransacoes(
  colunas: readonly string[],
  linhas: Record<string, string>[],
): string {
  return [
    colunas.join(";"),
    ...linhas.map((l) =>
      colunas.map((c) => (l[c] ?? "").replace(/[;\r\n]/g, " ")).join(";"),
    ),
  ].join("\n");
}
