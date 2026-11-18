import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  CargaRecusada,
  ehRendaVariavel,
  revisarCarga,
  transacoesDaCarga,
  type BaseDaCarga,
  type RevisaoDeCarga,
} from "../posicao-carga.js";
import type { RelatorioDeImportacaoDePosicao } from "../posicao-csv.js";
import { Transacao, type DecisaoDeDivergencia } from "../tipos.js";
import {
  audit_log,
  cargas_de_posicao,
  imports,
  portfolios,
  posicoes,
  transactions,
} from "./schema.js";
import type { TransacaoDoUsuario } from "./sessao.js";

type Tx = TransacaoDoUsuario<Record<string, unknown>>;

/** Le o que a revisao compara. `travar` segura as cargas ate o fim da transacao. */
export async function lerBaseDaCarga(
  tx: Tx,
  carteira: string,
  travar = false,
): Promise<BaseDaCarga> {
  const cargasDaCarteira = tx
    .select({
      corretora: cargas_de_posicao.corretora,
      data_posicao: cargas_de_posicao.data_posicao,
    })
    .from(cargas_de_posicao)
    .where(eq(cargas_de_posicao.portfolio_id, carteira));
  const cargas = await (travar ? cargasDaCarteira.for("update") : cargasDaCarteira);
  const linhas = await tx
    .select()
    .from(transactions)
    .where(eq(transactions.portfolio_id, carteira))
    .orderBy(asc(transactions.data));
  const vigentes = await tx
    .select({
      corretora: posicoes.corretora,
      chave_ativo: posicoes.chave_ativo,
      ativo: posicoes.ativo,
      classe: posicoes.classe,
      data_posicao: posicoes.data_posicao,
      saldo_bruto: posicoes.saldo_bruto,
      quantidade: posicoes.quantidade,
      valor_aplicado: posicoes.valor_aplicado,
    })
    .from(posicoes)
    .where(and(eq(posicoes.portfolio_id, carteira), eq(posicoes.vigente, true)));
  return {
    cargas,
    vigentes,
    transacoes: linhas.map((l) =>
      Transacao.parse({
        id: l.id,
        ticker: l.ticker,
        tipo: l.tipo,
        data: l.data,
        quantidade: l.quantidade,
        preco: l.preco,
        taxas: l.taxas,
        ...(l.corretora ? { corretora: l.corretora } : {}),
      }),
    ),
  };
}

export interface ResultadoDaCarga {
  importacao_id: string;
  revisao: RevisaoDeCarga;
  transacoes_geradas: number;
  posicoes_gravadas: number;
}

/**
 * Grava a carga na transacao de `comoUsuario`: se algo falhar, nada fica.
 *
 * Carga igual ou mais antiga que a vigente de qualquer corretora do arquivo
 * recusa o arquivo inteiro (`CargaRecusada`). A carga mais recente desliga as
 * posicoes vigentes so das corretoras presentes no arquivo.
 */
export async function gravarCargaDePosicao(
  tx: Tx,
  entrada: {
    uid: string;
    carteira: string;
    nome_arquivo: string;
    relatorio: RelatorioDeImportacaoDePosicao;
    decisoes: DecisaoDeDivergencia[];
    origem?: { ip: string | null; user_agent: string | null };
  },
): Promise<ResultadoDaCarga> {
  const { uid, carteira, relatorio, decisoes } = entrada;
  const revisao = revisarCarga(relatorio, await lerBaseDaCarga(tx, carteira, true));
  if (revisao.recusas.length > 0) throw new CargaRecusada(revisao.recusas);

  const importacao = randomUUID();
  const corretoras = revisao.totais_por_corretora.map((t) => t.corretora);
  if (corretoras.length > 0) {
    await tx
      .update(posicoes)
      .set({ vigente: false })
      .where(
        and(
          eq(posicoes.portfolio_id, carteira),
          eq(posicoes.vigente, true),
          inArray(posicoes.corretora, corretoras),
        ),
      );
  }

  const novas = relatorio.posicoes
    .filter((p) => !ehRendaVariavel(p))
    .map((p) => ({
      id: randomUUID(),
      portfolio_id: carteira,
      user_id: uid,
      importacao_id: importacao,
      corretora: p.corretora,
      data_posicao: p.data_posicao,
      chave_ativo: p.chave_ativo,
      classe: p.classe,
      subclasse: p.subclasse,
      ativo: p.ativo,
      codigo: p.codigo,
      cnpj: p.cnpj,
      emissor: p.emissor,
      indexador: p.indexador,
      pct_indexador: p.pct_indexador,
      taxa_aa: p.taxa_aa,
      data_aplicacao: p.data_aplicacao,
      vencimento: p.vencimento,
      liquidez_diaria: p.liquidez_diaria,
      quantidade: p.quantidade,
      preco_unitario: p.preco_unitario,
      preco_medio: p.preco_medio,
      valor_aplicado: p.valor_aplicado,
      saldo_bruto: p.saldo_bruto,
      ir: p.ir,
      iof: p.iof,
      saldo_liquido: p.saldo_liquido,
      valorizacao: p.valorizacao,
      observacao: p.observacao,
    }));
  for (let i = 0; i < novas.length; i += 500) {
    await tx.insert(posicoes).values(novas.slice(i, i + 500));
  }

  const geradas = transacoesDaCarga(revisao, decisoes);
  if (geradas.length > 0) {
    await tx.insert(transactions).values(
      geradas.map((t) => ({
        id: t.id,
        portfolio_id: carteira,
        user_id: uid,
        ticker: t.ticker,
        tipo: t.tipo,
        data: t.data,
        quantidade: t.quantidade,
        preco: t.preco,
        taxas: t.taxas,
        corretora: t.corretora ?? null,
        importacao_id: importacao,
      })),
    );
    // Snapshot e so de renda variavel: carga sem transacao nao muda o TWR.
    const desde = geradas.map((t) => t.data).sort()[0] as string;
    await tx
      .update(portfolios)
      .set({
        recalcular_desde: sql`least(coalesce(${portfolios.recalcular_desde}, ${desde}::date), ${desde}::date)`,
      })
      .where(eq(portfolios.id, carteira));
  }

  for (const t of revisao.totais_por_corretora) {
    const carga = {
      data_posicao: t.data_posicao,
      importacao_id: importacao,
    };
    await tx
      .insert(cargas_de_posicao)
      .values({ portfolio_id: carteira, user_id: uid, corretora: t.corretora, ...carga })
      .onConflictDoUpdate({
        target: [cargas_de_posicao.portfolio_id, cargas_de_posicao.corretora],
        set: carga,
      });
  }

  await tx.insert(imports).values({
    id: importacao,
    portfolio_id: carteira,
    user_id: uid,
    formato: "posicao_bolsiq",
    nome_arquivo: entrada.nome_arquivo.slice(0, 200),
    linhas_lidas: relatorio.linhas_lidas,
    linhas_aceitas: relatorio.posicoes.length,
    linhas_rejeitadas: relatorio.rejeicoes.length,
    rejeicoes: JSON.stringify(relatorio.rejeicoes),
    duracao_ms: relatorio.duracao_ms,
  });
  await tx.insert(audit_log).values({
    id: randomUUID(),
    user_id: uid,
    acao: "importacao",
    recurso: "portfolio",
    recurso_id: carteira,
    detalhe: `posicao_bolsiq: ${relatorio.posicoes.length} de ${relatorio.linhas_lidas}`,
    ip: entrada.origem?.ip ?? null,
    user_agent: entrada.origem?.user_agent ?? null,
  });

  return {
    importacao_id: importacao,
    revisao,
    transacoes_geradas: geradas.length,
    posicoes_gravadas: novas.length,
  };
}
