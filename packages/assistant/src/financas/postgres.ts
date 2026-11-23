import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  comoUsuario,
  comprometidoPorMes,
  fluxoDeCaixa,
  listarAssinaturas,
  listarInsights,
  listarPlanos,
  painelDoMes,
  schema,
  type Tx,
} from "@bolsiq/finance";
import { d } from "@bolsiq/finance/puro";
import type { Proveniencia } from "../tipos.js";
import { ErroParaOModelo } from "../ferramentas.js";
import { anonimizarDescricao } from "./anonimizar.js";
import type { FontesFinanceiras, LancamentoFinanceiro } from "./tipos.js";

type Banco = NodePgDatabase<Record<string, unknown>>;
const { accounts, cards, categories, transactions } = schema;

/** Teto de linhas lidas por periodo: a ferramenta resume antes de ir ao modelo. */
export const MAX_LINHAS_LIDAS = 5000;
const CATEGORIA_DE_APORTE = /invest|aporte|poupan/i;

/**
 * Implementacao de `FontesFinanceiras` sobre `packages/finance`, pela RLS do
 * usuario (`comoUsuario`). A mesma para o BFF e para o job do relatorio mensal.
 */
export function fontesFinanceirasDoBanco(
  db: Banco,
  uid: string,
  hoje: string,
): FontesFinanceiras {
  const como = <T>(fn: (tx: Tx) => Promise<T>) => comoUsuario(db, uid, fn);
  const prov: Proveniencia[] = [
    { fonte: "Lançamentos do usuário (Bolsiq Finanças)", data: hoje, atrasado: false },
  ];

  return {
    async resumoDoMes(competencia) {
      const p = await como((tx) => painelDoMes(tx, uid, `${competencia}-01`, hoje));
      return {
        dados: {
          competencia,
          renda: p.renda,
          despesas: p.despesas,
          fixos: p.fixos,
          variaveis: p.variaveis,
          saldo_previsto_fim_do_mes: p.saldo_previsto_fim_do_mes,
          comprometido_parcelas: p.comprometido_parcelas,
          orcamento: p.orcamento,
        },
        proveniencia: prov,
      };
    },

    async lancamentos(de, ate) {
      const linhas = await como((tx) =>
        tx
          .select({
            id: transactions.id,
            data: transactions.data,
            descricao: transactions.descricao,
            valor: transactions.valor,
            tipo: transactions.tipo,
            status: transactions.status,
            categoria: categories.nome,
            essencial: categories.essencial,
            tipo_custo: categories.tipo_custo,
            conta: accounts.nome,
            cartao: cards.nome,
            parcela: sql<boolean>`${transactions.installment_plan_id} is not null`,
          })
          .from(transactions)
          .leftJoin(
            categories,
            and(eq(categories.id, transactions.category_id), eq(categories.user_id, uid)),
          )
          .leftJoin(
            accounts,
            and(eq(accounts.id, transactions.account_id), eq(accounts.user_id, uid)),
          )
          .leftJoin(
            cards,
            and(eq(cards.id, transactions.card_id), eq(cards.user_id, uid)),
          )
          .where(
            and(
              eq(transactions.user_id, uid),
              // Pagamento de fatura e transferencia entre contas: o gasto ja
              // esta na compra.
              ne(transactions.tipo, "transferencia"),
              gte(transactions.data, de),
              lte(transactions.data, ate),
            ),
          )
          .orderBy(asc(transactions.data), asc(transactions.id))
          // Um a mais que o teto: passar dele e erro explicito, nunca soma parcial.
          .limit(MAX_LINHAS_LIDAS + 1),
      );
      if (linhas.length > MAX_LINHAS_LIDAS)
        throw new ErroParaOModelo(
          "periodo_grande",
          `O período tem mais de ${MAX_LINHAS_LIDAS} lançamentos. Peça um período menor.`,
        );
      return {
        dados: linhas.map((l): LancamentoFinanceiro => ({
          id: l.id,
          data: l.data,
          descricao: l.descricao,
          valor: l.valor,
          tipo: l.tipo as LancamentoFinanceiro["tipo"],
          status: l.status as LancamentoFinanceiro["status"],
          categoria: l.categoria,
          essencial: l.essencial ?? false,
          tipo_custo: (l.tipo_custo as LancamentoFinanceiro["tipo_custo"]) ?? null,
          aporte:
            l.tipo === "despesa" &&
            l.categoria !== null &&
            CATEGORIA_DE_APORTE.test(l.categoria),
          origem: l.cartao ?? l.conta,
          parcela: l.parcela,
        })),
        proveniencia: prov,
      };
    },

    async fluxo(meses) {
      return {
        dados: await como((tx) => fluxoDeCaixa(tx, uid, hoje, meses)),
        proveniencia: prov,
      };
    },

    async parcelas() {
      const [planos, porMes] = await como(
        async (tx) =>
          [await listarPlanos(tx, uid), await comprometidoPorMes(tx, uid, hoje)] as const,
      );
      return {
        dados: {
          planos: planos
            .filter((p) => p.ativo && p.parcelas_restantes > 0)
            .map((p) => ({
              descricao: anonimizarDescricao(p.descricao),
              origem: p.origem,
              parcelas_restantes: p.parcelas_restantes,
              valor_restante: p.valor_restante,
              proxima: p.proxima,
            })),
          por_mes: porMes.map((m) => ({ mes: m.mes, total: m.total })),
        },
        proveniencia: prov,
      };
    },

    async assinaturas() {
      const l = await como((tx) => listarAssinaturas(tx, uid, hoje));
      return {
        dados: {
          total_mensal: l.total_mensal,
          total_anual: l.total_anual,
          assinaturas: l.assinaturas
            .filter((a) => a.feedback?.acao !== "ja_cancelei")
            .map((a) => ({
              nome: anonimizarDescricao(a.nome),
              frequencia: a.frequencia,
              valor_atual: a.valor_atual,
              valor_mensal: a.valor_mensal,
              valor_anual: a.valor_anual,
              proxima: a.proxima,
              categoria: a.categoria,
              reajuste: a.reajuste,
              duplicidade: a.duplicidade.length > 0,
              nova: a.nova,
            })),
        },
        proveniencia: prov,
      };
    },

    async insights(mes) {
      const { lista, evidencias } = await como(async (tx) => {
        const lista = (await listarInsights(tx, uid, mes ?? hoje.slice(0, 7), hoje))
          .insights;
        const ids = [...new Set(lista.flatMap((i) => i.evidencias))];
        const evidencias = ids.length
          ? await tx
              .select({
                id: transactions.id,
                valor: transactions.valor,
                descricao: transactions.descricao,
                essencial: categories.essencial,
              })
              .from(transactions)
              .leftJoin(
                categories,
                and(
                  eq(categories.id, transactions.category_id),
                  eq(categories.user_id, uid),
                ),
              )
              .where(and(eq(transactions.user_id, uid), inArray(transactions.id, ids)))
          : [];
        return { lista, evidencias };
      });
      const porId = new Map(evidencias.map((e) => [e.id, e]));
      // O texto do insight repete a descricao do lancamento: o nome no PIX sai dali tambem.
      const trocas = [...new Set(evidencias.map((e) => e.descricao))]
        .map((o) => [o, anonimizarDescricao(o)] as const)
        .filter(([o, a]) => o !== a)
        .sort((a, b) => b[0].length - a[0].length);
      const limpar = (t: string) => trocas.reduce((s, [o, a]) => s.replaceAll(o, a), t);
      return {
        dados: lista.map((i) => {
          const ev = i.evidencias.flatMap((id) => porId.get(id) ?? []);
          const total = ev.reduce((s, e) => s.plus(e.valor), d(0));
          const essencial = ev
            .filter((e) => e.essencial)
            .reduce((s, e) => s.plus(e.valor), d(0));
          return {
            id: i.id,
            tipo: i.tipo,
            titulo: limpar(i.titulo),
            descricao: limpar(i.descricao),
            impacto_mensal: i.impacto_mensal,
            impacto_anual: i.impacto_anual,
            severidade: i.severidade,
            acao_sugerida: limpar(i.acao_sugerida),
            essencial: total.gt(0) && essencial.times(2).gt(total),
          };
        }),
        proveniencia: prov,
      };
    },
  };
}
