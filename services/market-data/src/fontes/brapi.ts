import { Decimal } from "decimal.js";
import { BolsiqError } from "@bolsiq/contracts";
import { obter, type Buscar } from "./http.js";

export const BRAPI_SOURCE = "brapi";
export const BRAPI_LICENSE = "brapi.dev, termos de uso; dado da B3 com atraso";

export interface CotacaoBrapi {
  ticker: string;
  price: string;
  change: string;
  changePercent: string;
  previousClose: string | null;
  open: string | null;
  high: string | null;
  low: string | null;
  volume: bigint | null;
  quotedAt: string;
}

export type TipoDeProvento =
  "dividendo" | "jcp" | "bonificacao" | "desdobramento" | "grupamento";

export interface ProventoBrapi {
  ticker: string;
  kind: TipoDeProvento;
  exDate: string;
  paymentDate: string | null;
  approvedOn: string | null;
  valuePerShare: string | null;
  factor: string | null;
  ratio: string | null;
}

export interface VelaBrapi {
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: number;
}

interface Resultado {
  symbol: string;
  regularMarketPrice?: number | null;
  regularMarketChange?: number | null;
  regularMarketChangePercent?: number | null;
  regularMarketPreviousClose?: number | null;
  regularMarketOpen?: number | null;
  regularMarketDayHigh?: number | null;
  regularMarketDayLow?: number | null;
  regularMarketVolume?: number | null;
  regularMarketTime?: string | null;
  historicalDataPrice?: {
    date: number;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
  }[];
  dividendsData?: {
    cashDividends?: {
      rate: number;
      label: string;
      lastDatePrior: string | null;
      exDate?: string | null;
      paymentDate: string | null;
      approvedOn: string | null;
    }[];
    stockDividends?: {
      factor: number;
      completeFactor: string;
      label: string;
      lastDatePrior: string | null;
      exDate?: string | null;
      approvedOn: string | null;
    }[];
  };
}

/**
 * A brapi devolve preco como number JSON. A conversao para string decimal
 * acontece aqui, na borda, e nunca passa por aritmetica de ponto flutuante:
 * `Decimal(52.71)` le o literal mais curto que representa o double, "52.71".
 */
function dec(v: number | null | undefined): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return new Decimal(v).toFixed();
}

/** Data no fuso de Sao Paulo: "2026-08-21T03:00:00.000Z" e 21/08 la. */
export function dataEmSaoPaulo(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function diaSeguinte(data: string): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const TIPO_POR_ROTULO: Record<string, TipoDeProvento> = {
  DIVIDENDO: "dividendo",
  JCP: "jcp",
  "JUROS SOBRE CAPITAL PROPRIO": "jcp",
  RENDIMENTO: "dividendo",
  BONIFICACAO: "bonificacao",
  DESDOBRAMENTO: "desdobramento",
  GRUPAMENTO: "grupamento",
};

function tipoDoRotulo(rotulo: string): TipoDeProvento | null {
  const normalizado = rotulo.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
  return TIPO_POR_ROTULO[normalizado] ?? null;
}

/**
 * Data-ex do provento. A brapi traz `exDate` em parte dos registros; quando
 * nao traz, a data-ex e o pregao seguinte a data-com (`lastDatePrior`). O dia
 * seguinte de calendario pode cair em fim de semana, o que nao muda o ajuste:
 * ele so compara datas.
 */
function dataEx(
  exDate: string | null | undefined,
  dataCom: string | null,
): string | null {
  if (exDate) return dataEmSaoPaulo(exDate);
  if (dataCom) return diaSeguinte(dataEmSaoPaulo(dataCom));
  return null;
}

export class BrapiAdapter {
  constructor(
    private readonly buscar: Buscar,
    private readonly token: string | undefined,
    private readonly base = "https://brapi.dev/api",
  ) {}

  private async consultar(caminho: string): Promise<Resultado | null> {
    const res = await obter(this.buscar, `${this.base}${caminho}`, {
      headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
    });
    // Sem token, a brapi so serve os tickers de demonstracao e responde 401
    // aos demais. Para o read-through e o mesmo que nao ter o dado.
    if (res.status === 401 || res.status === 403 || res.status === 404) return null;
    if (res.status === 429) {
      throw new BolsiqError("source_unavailable", "limite da brapi atingido");
    }
    if (!res.ok) {
      throw new BolsiqError("source_unavailable", `brapi respondeu ${res.status}`);
    }
    const corpo = (await res.json()) as { results?: Resultado[] };
    return corpo.results?.[0] ?? null;
  }

  async cotacao(ticker: string): Promise<CotacaoBrapi | null> {
    const r = await this.consultar(`/quote/${encodeURIComponent(ticker)}`);
    const price = dec(r?.regularMarketPrice);
    if (!r || price === null) return null;

    return {
      ticker,
      price,
      change: dec(r.regularMarketChange) ?? "0",
      changePercent: dec(r.regularMarketChangePercent) ?? "0",
      previousClose: dec(r.regularMarketPreviousClose),
      open: dec(r.regularMarketOpen),
      high: dec(r.regularMarketDayHigh),
      low: dec(r.regularMarketDayLow),
      volume:
        r.regularMarketVolume === null || r.regularMarketVolume === undefined
          ? null
          : BigInt(Math.round(r.regularMarketVolume)),
      quotedAt: new Date(r.regularMarketTime ?? Date.now()).toISOString(),
    };
  }

  async proventos(ticker: string): Promise<ProventoBrapi[] | null> {
    const r = await this.consultar(`/quote/${encodeURIComponent(ticker)}?dividends=true`);
    if (!r) return null;

    const saida: ProventoBrapi[] = [];
    for (const c of r.dividendsData?.cashDividends ?? []) {
      const kind = tipoDoRotulo(c.label);
      const exDate = dataEx(c.exDate, c.lastDatePrior);
      if (!kind || !exDate) continue;
      saida.push({
        ticker,
        kind,
        exDate,
        paymentDate: c.paymentDate ? dataEmSaoPaulo(c.paymentDate) : null,
        approvedOn: c.approvedOn ? dataEmSaoPaulo(c.approvedOn) : null,
        valuePerShare: dec(c.rate),
        factor: null,
        ratio: null,
      });
    }
    for (const s of r.dividendsData?.stockDividends ?? []) {
      const kind = tipoDoRotulo(s.label);
      const exDate = dataEx(s.exDate, s.lastDatePrior);
      if (!kind || !exDate) continue;
      saida.push({
        ticker,
        kind,
        exDate,
        paymentDate: null,
        approvedOn: s.approvedOn ? dataEmSaoPaulo(s.approvedOn) : null,
        valuePerShare: null,
        factor: multiplicadorDeAcoes(s.factor),
        ratio: s.completeFactor,
      });
    }
    return saida;
  }

  /** Serie diaria; usada para o IBOV (^BVSP), que exige token. */
  async historico(ticker: string, range: string): Promise<VelaBrapi[] | null> {
    const r = await this.consultar(
      `/quote/${encodeURIComponent(ticker)}?range=${range}&interval=1d`,
    );
    if (!r?.historicalDataPrice) return null;
    return r.historicalDataPrice.flatMap((h) => {
      const close = dec(h.close);
      if (close === null) return [];
      return [
        {
          date: dataEmSaoPaulo(new Date(h.date * 1000).toISOString()),
          open: dec(h.open) ?? close,
          high: dec(h.high) ?? close,
          low: dec(h.low) ?? close,
          close,
          volume: Math.round(h.volume ?? 0),
        },
      ];
    });
  }
}

/**
 * Multiplicador de acoes do evento, como a brapi publica: 2 em desdobramento
 * "2 para 1", 0.1 em grupamento "1 para 10" e 1.1 em bonificacao de 10%
 * (conferido em ITUB4, MGLU3 e VALE3).
 */
export function multiplicadorDeAcoes(factor: number): string | null {
  if (!Number.isFinite(factor) || factor <= 0) return null;
  return new Decimal(factor).toFixed();
}
