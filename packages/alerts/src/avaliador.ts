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

/** Valor em reais para o texto da notificacao: "R$ 52,71". */
function reais(v: Decimal | string, casas = 2): string {
  return `R$ ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(new Decimal(v).toNumber())}`;
}

function pct(fracao: number | Decimal): string {
  const n = typeof fracao === "number" ? fracao : fracao.toNumber();
  return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n * 100)}%`;
}

/** "2026-11-05" vira "05/11/2026". */
function data(iso: string): string {
  return iso.split("-").reverse().join("/");
}

const NOME_DO_PROVENTO: Record<string, string> = {
  dividendo: "dividendo",
  jcp: "JCP",
  bonificacao: "bonificação",
  desdobramento: "desdobramento",
  grupamento: "grupamento",
};

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
        titulo: `${cotacao.ticker} ${sentido} ${reais(limite)}`,
        corpo: `${cotacao.ticker} está em ${reais(preco)}.`,
        dados: {
          ticker: cotacao.ticker,
          tipo: r.tipo,
          preco: cotacao.price,
          limite: r.params.valor,
        },
      });
    } else if (r.tipo === "variacao_diaria") {
      // `change` e a variacao absoluta sobre o fechamento anterior.
      const anterior = preco.minus(variacao);
      if (anterior.lte(0)) continue;
      const variacaoDia = variacao.div(anterior);
      if (variacaoDia.abs().lt(r.params.percentual) || emCooldown(r, agora)) continue;

      disparos.push({
        regra: r,
        titulo: `${cotacao.ticker} ${variacaoDia.isNeg() ? "cai" : "sobe"} ${pct(variacaoDia.abs())} no dia`,
        corpo: `${cotacao.ticker} está em ${reais(preco)}.`,
        dados: {
          ticker: cotacao.ticker,
          tipo: r.tipo,
          preco: cotacao.price,
          variacao: variacaoDia.toNumber(),
        },
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
        titulo: `${ind.ticker} com DY de ${pct(ind.dy_12m)}`,
        corpo: `Acima dos ${pct(r.params.percentual)} configurados.`,
        dados: { ticker: ind.ticker, tipo: r.tipo, dy_12m: ind.dy_12m },
      });
      continue;
    }

    if (ultimoPreco === undefined) continue;
    const preco = new Decimal(ultimoPreco);

    if (r.tipo === "abaixo_graham" && ind.preco_graham !== null) {
      if (preco.gte(ind.preco_graham)) continue;
      disparos.push({
        regra: r,
        titulo: `${ind.ticker} abaixo do preço justo de Graham`,
        corpo: `Preço ${reais(preco)}, preço justo ${reais(ind.preco_graham)}. Não é recomendação.`,
        dados: {
          ticker: ind.ticker,
          tipo: r.tipo,
          preco: ultimoPreco,
          preco_graham: ind.preco_graham,
        },
      });
    } else if (r.tipo === "abaixo_bazin" && ind.preco_bazin !== null) {
      if (preco.gte(ind.preco_bazin)) continue;
      disparos.push({
        regra: r,
        titulo: `${ind.ticker} abaixo do preço-teto de Bazin`,
        corpo: `Preço ${reais(preco)}, teto ${reais(ind.preco_bazin)}. Não é recomendação.`,
        dados: {
          ticker: ind.ticker,
          tipo: r.tipo,
          preco: ultimoPreco,
          preco_bazin: ind.preco_bazin,
        },
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
        titulo: `${p.ticker} anunciou ${NOME_DO_PROVENTO[p.kind] ?? p.kind}`,
        corpo: p.value_per_share
          ? `${reais(p.value_per_share, 4)} por ação, data ex ${data(p.ex_date)}.`
          : `Data ex ${data(p.ex_date)}.`,
        dados: { ...p, tipo: r.tipo },
      });
    } else if (r.tipo === "data_com_proxima") {
      // Data com ja passada nao avisa: o direito ja foi decidido.
      if (diasAteEx < 0 || diasAteEx > r.params.dias) continue;
      disparos.push({
        regra: r,
        titulo: `Data ex de ${p.ticker} em ${diasAteEx} ${diasAteEx === 1 ? "dia" : "dias"}`,
        corpo: `Quem tiver ${p.ticker} antes de ${data(p.ex_date)} recebe o ${NOME_DO_PROVENTO[p.kind] ?? p.kind}.`,
        dados: { ...p, tipo: r.tipo, dias_ate_ex: diasAteEx },
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
      titulo: `${ticker} publicou ${d.statement_kind} de ${data(d.period_end)}`,
      corpo: "Demonstração financeira nova ou reapresentada. Indicadores recalculados.",
      dados: { ...d, ticker, tipo: r.tipo },
    }));
  return { disparos, rearmar: [] };
}
