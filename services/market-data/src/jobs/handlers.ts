import { z } from "zod";
import type { Db } from "@bolsiq/db-core";
import { SERIES_SGS } from "@bolsiq/domain";
import type { B3CotahistAdapter } from "../fontes/b3-cotahist.js";
import type { BcbAdapter } from "../fontes/bcb.js";
import type { CvmAdapter } from "../fontes/cvm.js";
import {
  carregarCadastro,
  carregarCotahist,
  carregarCadastroDeFundos,
  carregarDemonstracoes,
  carregarInformeDiario,
  carregarInformeFii,
  ligarFiisAosTickers,
  ultimosMeses,
  gravarSerieMacro,
  ultimaDataDaSerie,
  type Log,
} from "../dados/ingestao.js";

export interface ContextoDeJob {
  db: Db;
  cotahist: B3CotahistAdapter;
  cvm: CvmAdapter;
  bcb: BcbAdapter;
  log: Log;
  agora?: () => Date;
}

const Ano = z.coerce.number().int().min(1986).max(2100);
const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function hojeEmSp(agora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    agora,
  );
}

/** Séries do SGS que o bcb-sgs mantém. */
export const SERIES_DO_JOB = [
  SERIES_SGS.cdiDiario,
  SERIES_SGS.selicDiaria,
  SERIES_SGS.ipcaMensal,
  SERIES_SGS.igpmMensal,
];

/**
 * O que cada job faz. O worker e o backfill chamam a mesma função: a carga
 * histórica não tem caminho próprio que possa divergir do agendado.
 */
export async function executarJob(
  nome: string,
  dados: unknown,
  ctx: ContextoDeJob,
): Promise<Record<string, unknown>> {
  const agora = (ctx.agora ?? (() => new Date()))();
  const anoAtual = Number(hojeEmSp(agora).slice(0, 4));
  const d = (dados ?? {}) as Record<string, unknown>;

  switch (nome) {
    case "b3-cotahist-diario": {
      const data = Data.parse(d.date ?? hojeEmSp(agora));
      const arquivo = await ctx.cotahist.dia(data);
      // Feriado e fim de semana: a B3 responde 404. Não é falha do job.
      if (!arquivo) return { data, sem_pregao: true };
      return {
        data,
        ...(await carregarCotahist(ctx.db, arquivo, { diario: true, log: ctx.log })),
      };
    }

    case "b3-cotahist-anual": {
      const ano = Ano.parse(d.ano);
      const arquivo = await ctx.cotahist.ano(ano);
      if (!arquivo) return { ano, sem_arquivo: true };
      return {
        ano,
        ...(await carregarCotahist(ctx.db, arquivo, { diario: false, log: ctx.log })),
      };
    }

    case "cvm-cadastro":
      return {
        ...(await carregarCadastro(ctx.db, ctx.cvm, { ano: anoAtual, log: ctx.log })),
      };

    case "cvm-dfp":
    case "cvm-itr": {
      const tipo = nome === "cvm-dfp" ? "DFP" : "ITR";
      // Sem ano explícito, confere o corrente e o anterior: o DFP do ano
      // passado ainda recebe reapresentação. O hash evita reprocessar.
      const anos = d.ano === undefined ? [anoAtual - 1, anoAtual] : [Ano.parse(d.ano)];
      const resultados: Record<string, unknown> = {};
      for (const ano of anos) {
        resultados[ano] = await carregarDemonstracoes(ctx.db, ctx.cvm, {
          tipo,
          ano,
          log: ctx.log,
        });
      }
      return resultados;
    }

    case "bcb-sgs": {
      const ate = hojeEmSp(agora);
      const resultados: Record<string, number> = {};
      for (const serie of SERIES_DO_JOB) {
        const ultima = await ultimaDataDaSerie(ctx.db, serie.code);
        const de =
          d.from !== undefined ? Data.parse(d.from) : (ultima ?? `${anoAtual - 1}-01-01`);
        const pontos = await ctx.bcb.serie(serie.code, de, ate);
        resultados[serie.code] = await gravarSerieMacro(
          ctx.db,
          { ...serie, sourceRef: `bcdata.sgs.${serie.code}` },
          pontos,
        );
      }
      return resultados;
    }

    case "cvm-fundos": {
      // Cadastro e o mes corrente e o anterior (o informe do mes anterior
      // ainda recebe retificacao). `meses` amplia, para a carga historica.
      const meses =
        d.meses === undefined
          ? 2
          : z.coerce.number().int().min(1).max(120).parse(d.meses);
      const cadastro = await carregarCadastroDeFundos(ctx.db, ctx.cvm, { log: ctx.log });
      const informes: Record<string, unknown> = {};
      for (const aaaamm of ultimosMeses(hojeEmSp(agora), meses)) {
        informes[aaaamm] = await carregarInformeDiario(ctx.db, ctx.cvm, {
          aaaamm,
          log: ctx.log,
        });
      }
      return { cadastro, informes };
    }

    case "cvm-fii-mensal": {
      // Como no DFP: o ano anterior ainda recebe reapresentacao.
      const anos = d.ano === undefined ? [anoAtual - 1, anoAtual] : [Ano.parse(d.ano)];
      const resultados: Record<string, unknown> = {};
      for (const ano of anos) {
        resultados[ano] = await carregarInformeFii(ctx.db, ctx.cvm, {
          ano,
          log: ctx.log,
        });
      }
      // Arquivo pulado pelo hash nao liga ticker que o COTAHIST criou depois.
      resultados.tickers_ligados = await ligarFiisAosTickers(ctx.db);
      return resultados;
    }

    case "ajuste-proventos":
      // O ajuste é calculado na leitura de /v1/history, então não há coluna a
      // recalcular. Segue no registro para a agenda e o /admin/jobs não
      // mudarem de forma.
      ctx.log("warn", `job ${nome} sem efeito nesta versão`);
      return { sem_efeito: true };

    default:
      throw new Error(`job sem manipulador: ${nome}`);
  }
}
