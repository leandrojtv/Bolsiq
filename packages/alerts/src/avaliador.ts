import { Decimal } from "decimal.js";
import type { Regra } from "./regras.js";

export interface Disparo {
  regra: Regra;
  titulo: string;
  corpo: string;
  dados: Record<string, unknown>;
}

export interface Resultado {
  disparos: Disparo[];
  /** Regras que mudam de estado sem disparar (rearme pela histerese). */
  rearmar: string[];
}

interface Cotacao {
  ticker: string;
  price: string;
  change: string;
}

interface Indicadores {
  ticker: string;
  preco_graham: string | null;
  preco_bazin: string | null;
  dy_12m: number | null;
}

interface Provento {
  ticker: string;
  kind: string;
  value_per_share: string | null;
  ex_date: string;
}

interface Demonstrativo {
  tickers: string[];
  period_end: string;
  statement_kind: string;
}

/** O cooldown bloqueia repeticao dentro da janela da propria regra. */
export function emCooldown(regra: Regra, agora: Date): boolean {
  if (regra.ultimo_disparo_em === null) return false;
  const ultimo = Date.parse(regra.ultimo_disparo_em);
  return agora.getTime() - ultimo < regra.cooldown_segundos * 1000;
}

/**
 * Avalia regras de preco contra uma cotacao.
 *
 * `preco_acima` e `preco_abaixo` sao de cruzamento, com histerese: disparam e
 * desarmam, e rearmam quando a condicao deixa de valer. Sem histerese, uma
 * cotacao oscilando em volta do limite dispararia a cada tick.
 */
export function avaliarCotacao(
  regras: Regra[],
  cotacao: Cotacao,
  agora: Date,
): Resultado {
  const preco = new Decimal(cotacao.price);
  const variacao = new Decimal(cotacao.change);
  const disparos: Disparo[] = [];
  const rearmar: string[] = [];

  for (const r of regras) {
    if (r.tipo === "preco_acima" || r.tipo === "preco_abaixo") {
      const limite = new Decimal(r.params.valor);
      const vale = r.tipo === "preco_acima" ? preco.gt(limite) : preco.lt(limite);

      if (!vale) {
        if (!r.armado) rearmar.push(r.id);
        continue;
      }
      if (!r.armado || emCooldown(r, agora)) continue;

      const sentido = r.tipo === "preco_acima" ? "acima de" : "abaixo de";
      disparos.push({
        regra: r,
        titulo: `${cotacao.ticker} ${sentido} R$ ${limite.toFixed(2)}`,
        corpo: `${cotacao.ticker} esta em R$ ${preco.toFixed(2)}.`,
        dados: { preco: cotacao.price, limite: r.params.valor },
      });
    } else if (r.tipo === "variacao_diaria") {
      // `change` e a variacao absoluta sobre o fechamento anterior.
      const anterior = preco.minus(variacao);
      if (anterior.lte(0)) continue;
      const pct = variacao.div(anterior);
      if (pct.abs().lt(r.params.percentual) || emCooldown(r, agora)) continue;

      disparos.push({
        regra: r,
        titulo: `${cotacao.ticker} ${pct.isNeg() ? "cai" : "sobe"} ${pct.abs().times(100).toFixed(2)}% no dia`,
        corpo: `${cotacao.ticker} esta em R$ ${preco.toFixed(2)}.`,
        dados: { preco: cotacao.price, variacao: pct.toNumber() },
      });
    }
  }

  return { disparos, rearmar };
}

/**
 * Avalia regras fundamentalistas contra o recalculo de indicadores.
 *
 * O preco do ativo nao vem neste evento; a comparacao usa o ultimo preco que o
 * motor viu, que o chamador informa. Sem preco conhecido, nada dispara: comparar
 * preco justo com preco desconhecido nao tem resposta.
 */
export function avaliarIndicadores(
  regras: Regra[],
  ind: Indicadores,
  ultimoPreco: string | undefined,
  agora: Date,
): Resultado {
  const disparos: Disparo[] = [];

  for (const r of regras) {
    if (emCooldown(r, agora)) continue;

    if (r.tipo === "dy_acima") {
      if (ind.dy_12m === null || ind.dy_12m <= r.params.percentual) continue;
      disparos.push({
        regra: r,
        titulo: `${ind.ticker} com DY de ${(ind.dy_12m * 100).toFixed(2)}%`,
        corpo: `Acima dos ${(r.params.percentual * 100).toFixed(2)}% configurados.`,
        dados: { dy_12m: ind.dy_12m },
      });
      continue;
    }

    if (ultimoPreco === undefined) continue;
    const preco = new Decimal(ultimoPreco);

    if (r.tipo === "abaixo_graham" && ind.preco_graham !== null) {
      if (preco.gte(ind.preco_graham)) continue;
      disparos.push({
        regra: r,
        titulo: `${ind.ticker} abaixo do preco justo de Graham`,
        corpo: `Preco R$ ${preco.toFixed(2)}, preco justo R$ ${new Decimal(ind.preco_graham).toFixed(2)}.`,
        dados: { preco: ultimoPreco, preco_graham: ind.preco_graham },
      });
    } else if (r.tipo === "abaixo_bazin" && ind.preco_bazin !== null) {
      if (preco.gte(ind.preco_bazin)) continue;
      disparos.push({
        regra: r,
        titulo: `${ind.ticker} abaixo do preco-teto de Bazin`,
        corpo: `Preco R$ ${preco.toFixed(2)}, teto R$ ${new Decimal(ind.preco_bazin).toFixed(2)}.`,
        dados: { preco: ultimoPreco, preco_bazin: ind.preco_bazin },
      });
    }
  }

  return { disparos, rearmar: [] };
}

/** Avalia regras de provento contra um anuncio. */
export function avaliarProvento(regras: Regra[], p: Provento, agora: Date): Resultado {
  const disparos: Disparo[] = [];
  const hoje = Date.parse(agora.toISOString().slice(0, 10));
  const exDate = Date.parse(p.ex_date);
  const diasAteEx = Math.round((exDate - hoje) / 86_400_000);

  for (const r of regras) {
    if (emCooldown(r, agora)) continue;

    if (r.tipo === "provento_anunciado") {
      disparos.push({
        regra: r,
        titulo: `${p.ticker} anunciou ${p.kind}`,
        corpo: p.value_per_share
          ? `R$ ${new Decimal(p.value_per_share).toFixed(4)} por acao, data com ${p.ex_date}.`
          : `Data com ${p.ex_date}.`,
        dados: { ...p },
      });
    } else if (r.tipo === "data_com_proxima") {
      // Data com ja passada nao avisa: o direito ja foi decidido.
      if (diasAteEx < 0 || diasAteEx > r.params.dias) continue;
      disparos.push({
        regra: r,
        titulo: `Data com de ${p.ticker} em ${diasAteEx} dia(s)`,
        corpo: `Quem tiver ${p.ticker} ate ${p.ex_date} recebe o ${p.kind}.`,
        dados: { ...p, dias_ate_ex: diasAteEx },
      });
    }
  }

  return { disparos, rearmar: [] };
}

/** Avalia regras de demonstrativo publicado. Um evento vale para todos os tickers da empresa. */
export function avaliarDemonstrativo(
  regras: Regra[],
  ticker: string,
  d: Demonstrativo,
  agora: Date,
): Resultado {
  const disparos = regras
    .filter((r) => r.tipo === "demonstrativo_publicado" && !emCooldown(r, agora))
    .map((r) => ({
      regra: r,
      titulo: `${ticker} publicou ${d.statement_kind} de ${d.period_end}`,
      corpo: `Demonstracao financeira nova ou reapresentada.`,
      dados: { ...d },
    }));
  return { disparos, rearmar: [] };
}
