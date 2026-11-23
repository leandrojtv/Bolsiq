import { and, asc, eq } from "drizzle-orm";
import { d } from "./decimal.js";
import { apurar, avaliar } from "./posicao.js";
import { ClasseDePosicao, Transacao } from "./tipos.js";
import type { TransacaoDoUsuario } from "./db/sessao.js";
import { portfolios, posicoes, transactions } from "./db/schema.js";

/**
 * Patrimonio das carteiras por grupo, para o Painel geral (ADR 0037). O que tem
 * ticker (acao, FII, BDR, ETF) vale pela cotacao e e renda variavel; o que veio
 * do extrato vale pelo saldo bruto da carga vigente, no grupo da classe.
 */
export type GrupoDoPatrimonio = "renda_variavel" | "renda_fixa" | "fundos";

export const GRUPO_DA_CLASSE: Record<ClasseDePosicao, GrupoDoPatrimonio> = {
  acao: "renda_variavel",
  fii: "renda_variavel",
  bdr: "renda_variavel",
  etf: "renda_variavel",
  cripto: "renda_variavel",
  outro: "renda_variavel",
  renda_fixa: "renda_fixa",
  titulo_publico: "renda_fixa",
  coe: "renda_fixa",
  estruturado: "renda_fixa",
  fundo: "fundos",
  previdencia: "fundos",
};

export interface CarteiraParaOPatrimonio {
  id: string;
  nome: string;
  transacoes: Transacao[];
  posicoes: { classe: ClasseDePosicao; saldo_bruto: string }[];
}

export interface PatrimonioDasCarteiras {
  renda_variavel: string;
  renda_fixa: string;
  fundos: string;
  /** `valor` nulo: carteira com ativo aberto e nenhuma cotacao. */
  carteiras: { id: string; nome: string; valor: string | null }[];
  /** Tickers abertos sem cotacao: ficam fora da soma, como na carteira. */
  sem_cotacao: string[];
}

export function tickersAbertos(carteiras: CarteiraParaOPatrimonio[]): string[] {
  const t = new Set<string>();
  for (const c of carteiras)
    for (const p of apurar(c.transacoes).posicoes)
      if (d(p.quantidade).gt(0)) t.add(p.ticker);
  return [...t].sort();
}

export function patrimonioDasCarteiras(
  carteiras: CarteiraParaOPatrimonio[],
  precos: Record<string, string>,
): PatrimonioDasCarteiras {
  const grupos = { renda_variavel: d(0), renda_fixa: d(0), fundos: d(0) };
  const semCotacao = new Set<string>();
  const porCarteira = carteiras.map((c) => {
    const abertas = apurar(c.transacoes).posicoes.filter((p) => d(p.quantidade).gt(0));
    const avaliadas = avaliar(abertas, precos);
    let valor = d(0);
    let algumValor = c.posicoes.length > 0 || abertas.length === 0;
    for (const p of avaliadas) {
      if (p.valor_de_mercado === null) {
        semCotacao.add(p.ticker);
        continue;
      }
      algumValor = true;
      valor = valor.plus(p.valor_de_mercado);
      grupos.renda_variavel = grupos.renda_variavel.plus(p.valor_de_mercado);
    }
    for (const p of c.posicoes) {
      valor = valor.plus(p.saldo_bruto);
      const g = GRUPO_DA_CLASSE[p.classe];
      grupos[g] = grupos[g].plus(p.saldo_bruto);
    }
    return { id: c.id, nome: c.nome, valor: algumValor ? valor.toFixed(2) : null };
  });
  return {
    renda_variavel: grupos.renda_variavel.toFixed(2),
    renda_fixa: grupos.renda_fixa.toFixed(2),
    fundos: grupos.fundos.toFixed(2),
    carteiras: porCarteira,
    sem_cotacao: [...semCotacao].sort(),
  };
}

/** Carteiras nao arquivadas do usuario, com transacoes e posicoes vigentes. */
export async function carteirasParaOPatrimonio<S extends Record<string, unknown>>(
  tx: TransacaoDoUsuario<S>,
  uid: string,
): Promise<CarteiraParaOPatrimonio[]> {
  const lista = await tx
    .select({ id: portfolios.id, nome: portfolios.nome })
    .from(portfolios)
    .where(and(eq(portfolios.user_id, uid), eq(portfolios.arquivada, false)))
    .orderBy(asc(portfolios.criada_em));
  const r: CarteiraParaOPatrimonio[] = [];
  for (const c of lista) {
    const linhas = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.portfolio_id, c.id))
      .orderBy(asc(transactions.data));
    const vigentes = await tx
      .select({ classe: posicoes.classe, saldo_bruto: posicoes.saldo_bruto })
      .from(posicoes)
      .where(and(eq(posicoes.portfolio_id, c.id), eq(posicoes.vigente, true)));
    r.push({
      ...c,
      transacoes: linhas.map((l) =>
        Transacao.parse({
          id: l.id,
          ticker: l.ticker,
          tipo: l.tipo,
          data: l.data,
          quantidade: l.quantidade,
          preco: l.preco,
          taxas: l.taxas,
        }),
      ),
      posicoes: vigentes.map((v) => ({
        classe: ClasseDePosicao.parse(v.classe),
        saldo_bruto: v.saldo_bruto,
      })),
    });
  }
  return r;
}
