import { sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { IndicadorFiltravel, type FiltroDeScreener } from "./screener.js";

export interface LinhaDoScreener {
  ticker: string;
  name: string;
  kind: string;
  sector: string | null;
  reference_date: string;
  /** Fechamento usado no calculo dos indicadores. */
  preco: string | null;
  indicadores: Partial<Record<IndicadorFiltravel, number | null>>;
}

export interface ResultadoDoScreener {
  total: number;
  linhas: LinhaDoScreener[];
}

type Banco = Pick<NodePgDatabase<Record<string, unknown>>, "execute">;

/** Coluna a partir do enum: nome de coluna nunca vem de texto livre. */
function coluna(nome: IndicadorFiltravel): SQL {
  return sql`${sql.identifier(IndicadorFiltravel.parse(nome))}`;
}

/**
 * Executa o filtro sobre o indicador mais recente de cada ticker.
 *
 * Faixa so casa indicador definido: `NULL >= 0` nao e verdadeiro, entao empresa
 * sem P/L sai de um filtro de P/L, que e o que se quer. A ordenacao poe nulos
 * por ultimo e, por padrao, os exclui (ver `incluir_indefinidos`).
 */
export async function executarScreener(
  db: Banco,
  filtro: FiltroDeScreener,
): Promise<ResultadoDoScreener> {
  const condicoes: SQL[] = [sql`m.listed = 'true'`];

  for (const [nome, faixa] of Object.entries(filtro.faixas)) {
    const c = coluna(nome as IndicadorFiltravel);
    if (faixa.min !== undefined) condicoes.push(sql`i.${c} >= ${faixa.min}`);
    if (faixa.max !== undefined) condicoes.push(sql`i.${c} <= ${faixa.max}`);
  }
  if (filtro.setores?.length) {
    condicoes.push(
      sql`m.sector IN (${sql.join(
        filtro.setores.map((s) => sql`${s}`),
        sql`, `,
      )})`,
    );
  }
  if (filtro.tipos?.length) {
    condicoes.push(
      sql`m.kind IN (${sql.join(
        filtro.tipos.map((t) => sql`${t}`),
        sql`, `,
      )})`,
    );
  }
  if (filtro.liquidez_minima !== undefined) {
    condicoes.push(sql`i.liquidez_diaria >= ${filtro.liquidez_minima}`);
  }
  const ordem = coluna(filtro.ordenar_por);
  if (!filtro.incluir_indefinidos) condicoes.push(sql`i.${ordem} IS NOT NULL`);

  const onde = sql.join(condicoes, sql` AND `);
  const direcao = filtro.ordem === "desc" ? sql`DESC` : sql`ASC`;
  const colunas = sql.join(
    IndicadorFiltravel.options.map(
      (n) => sql`i.${sql.identifier(n)}::float8 AS ${sql.identifier(n)}`,
    ),
    sql`, `,
  );

  const consulta = sql`
    WITH ultimos AS (
      SELECT DISTINCT ON (ticker) * FROM analytics.indicators
      ORDER BY ticker, reference_date DESC
    )
    SELECT i.ticker, m.name, m.kind, m.sector, i.reference_date::text AS reference_date,
           i.preco::text AS preco,
           ${colunas}, count(*) OVER ()::int AS total
    FROM ultimos i
    JOIN analytics.assets_mirror m ON m.ticker = i.ticker
    WHERE ${onde}
    ORDER BY i.${ordem} ${direcao} NULLS LAST, i.ticker
    LIMIT ${filtro.limite} OFFSET ${filtro.deslocamento}`;

  const r = await db.execute<Record<string, unknown>>(consulta);
  const linhas = r.rows.map((row) => ({
    ticker: row.ticker as string,
    name: row.name as string,
    kind: row.kind as string,
    sector: (row.sector as string | null) ?? null,
    reference_date: row.reference_date as string,
    preco: (row.preco as string | null) ?? null,
    indicadores: Object.fromEntries(
      IndicadorFiltravel.options.map((n) => [n, (row[n] as number | null) ?? null]),
    ),
  }));
  return { total: (r.rows[0]?.total as number | undefined) ?? 0, linhas };
}
